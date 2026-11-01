#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "claim.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "sdkconfig.h"

static const char *TAG = "claim";

m2_claim_result_t m2_claim(const char *uid, const char *secret, const char *code, char *board_id, size_t board_id_len, char *broker_secret, size_t broker_secret_len)
{
    char url[160];
    snprintf(url, sizeof(url), "%s/api/v1/boards/claim", CONFIG_M2_API_URL);
#if !CONFIG_M2_DEV_INSECURE
    if (strncmp(url, "https://", 8) != 0) {
        ESP_LOGE(TAG, "The server address must be https://");
        return M2_CLAIM_NO_SERVER;
    }
#endif

    cJSON *body = cJSON_CreateObject();
    cJSON_AddStringToObject(body, "hardwareUid", uid);
    cJSON_AddStringToObject(body, "secret", secret);
    cJSON_AddStringToObject(body, "code", code);
    char *payload = cJSON_PrintUnformatted(body);
    cJSON_Delete(body);

    char answer[512] = { 0 };
    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 15000,
        // Our server has a publicly trusted certificate: checked against the bundled roots.
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    m2_claim_result_t result = M2_CLAIM_NO_SERVER;
    if (esp_http_client_open(client, strlen(payload)) == ESP_OK) {
        esp_http_client_write(client, payload, strlen(payload));
        esp_http_client_fetch_headers(client);
        int status = esp_http_client_get_status_code(client);
        esp_http_client_read_response(client, answer, sizeof(answer) - 1);
        ESP_LOGI(TAG, "Claim answered %d", status);
        if (status == 200) {
            cJSON *json = cJSON_Parse(answer);
            const cJSON *id = cJSON_GetObjectItem(json, "boardId");
            const cJSON *broker = cJSON_GetObjectItem(json, "brokerSecret");
            if (cJSON_IsString(id) && cJSON_IsString(broker)) {
                strlcpy(board_id, id->valuestring, board_id_len);
                strlcpy(broker_secret, broker->valuestring, broker_secret_len);
                result = M2_CLAIM_OK;
            }
            cJSON_Delete(json);
        } else if (status == 401) {
            result = M2_CLAIM_WRONG_CODE;
        } else if (status == 409) {
            result = M2_CLAIM_WRONG_PRODUCT;
        } else if (status == 429) {
            result = M2_CLAIM_TOO_MANY;
        }
    } else {
        ESP_LOGW(TAG, "Server not reachable at %s", url);
    }
    esp_http_client_cleanup(client);
    free(payload);
    return result;
}
