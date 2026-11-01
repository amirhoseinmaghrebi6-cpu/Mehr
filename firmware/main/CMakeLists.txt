idf_component_register(
    SRCS "app_main.c" "board.c" "channels.c" "keys.c" "storage.c" "net.c" "setup_mode.c" "claim.c" "cloud.c"
    INCLUDE_DIRS "."
    EMBED_TXTFILES "setup_page.html" "../certs/board_ca.pem"
    REQUIRES nvs_flash esp_wifi esp_netif esp_event esp_http_server esp_http_client esp-tls mbedtls mqtt json esp_driver_gpio esp_timer esp_app_format)
