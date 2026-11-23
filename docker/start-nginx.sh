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

trusted_proxy=${GRANBOARD_TRUSTED_PROXY:-}
lan_cidr=${GRANBOARD_LAN_CIDR:-}
for address in "$trusted_proxy" "$lan_cidr"; do
    case "$address" in
        '') continue ;;
        *[!0-9a-fA-F.:/]*)
            printf '%s\n' 'GranBoard network settings must be IP addresses or CIDR ranges.' >&2
            exit 1 ;;
    esac
    if ! printf '%s\n' "$address" | grep -Eq '^[0-9a-fA-F.:]+(/[1-9][0-9]{0,2})?$'; then
        printf '%s\n' 'GranBoard network settings require an IP address or a nonzero CIDR prefix.' >&2
        exit 1
    fi
done

{
    if [ -n "$trusted_proxy" ] && [ -n "$lan_cidr" ]; then
        printf 'set_real_ip_from %s;\n' "$trusted_proxy"
        printf '%s\n' 'real_ip_header X-Real-IP;'
    fi
    printf '%s\n' 'geo $realip_remote_addr $granboard_trusted_proxy { default 0;'
    if [ -n "$trusted_proxy" ]; then printf '%s 1;\n' "$trusted_proxy"; fi
    printf '%s\n' '}' 'geo $remote_addr $granboard_lan { default 0;'
    if [ -n "$lan_cidr" ]; then printf '%s 1;\n' "$lan_cidr"; fi
    printf '%s\n' '}'
} > /tmp/scoretrackrr-granboard-network.conf

sed "s/@GRANBOARD_HOST@/$granboard_host/g" /etc/nginx/granboard-proxy.conf > /tmp/scoretrackrr-granboard.conf
exec nginx "$@"
