#!/bin/sh
set -eu

export LC_ALL=C
granboard_host=${GRANBOARD_HOST:-granboard}
case "$granboard_host" in
    *[!a-zA-Z0-9_.-]*)
        printf '%s\n' 'GRANBOARD_HOST must be a hostname without a scheme, port, or path.' >&2
        exit 1
        ;;
esac

sed "s/@GRANBOARD_HOST@/$granboard_host/g" /etc/nginx/granboard-proxy.conf > /tmp/scoretrackrr-granboard.conf
exec nginx "$@"
