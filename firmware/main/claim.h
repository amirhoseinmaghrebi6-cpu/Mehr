/*
 * The claim (docs/board-protocol.md, "Pairing", step 4): with its factory secret and the setup code
 * the user gave, the board asks the server to join the home and gets its broker account.
 */
#pragma once

#include <stddef.h>

typedef enum {
    M2_CLAIM_OK,
    /** 401: wrong code, or used by another board, or expired. */
    M2_CLAIM_WRONG_CODE,
    /** 409: the code waits for a different product. */
    M2_CLAIM_WRONG_PRODUCT,
    /** 429: too many wrong codes this hour. */
    M2_CLAIM_TOO_MANY,
    /** No answer, or an unexpected one. */
    M2_CLAIM_NO_SERVER,
} m2_claim_result_t;

m2_claim_result_t m2_claim(const char *uid, const char *secret, const char *code, char *board_id, size_t board_id_len, char *broker_secret, size_t broker_secret_len);
