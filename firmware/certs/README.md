# Board certificate authority

`board_ca.pem` is the certificate of our own certificate authority for the boards' broker: the
firmware trusts only a broker certificate signed by it (`infra/prod/certs.sh` makes both).

It is not in git, because each server has its own. Before a build, copy the server's
`infra/prod/certs/ca/ca.crt` here as `board_ca.pem`. Only the certificate goes here, never `ca.key`.
