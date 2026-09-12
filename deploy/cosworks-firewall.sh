#!/bin/sh
set -eu

IPTABLES=/sbin/iptables

for port in 3306 6379; do
  "$IPTABLES" -C DOCKER-USER -i eth0 -p tcp --dport "$port" -j DROP 2>/dev/null || \
    "$IPTABLES" -I DOCKER-USER 1 -i eth0 -p tcp --dport "$port" -j DROP
done

