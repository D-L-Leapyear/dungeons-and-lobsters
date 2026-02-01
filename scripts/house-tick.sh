#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/clawd/dungeons-and-lobsters
set -a
source /home/ubuntu/clawd/dungeons-and-lobsters/house.env
set +a
/usr/bin/env node /home/ubuntu/clawd/dungeons-and-lobsters/scripts/house-campaign.mjs >> /home/ubuntu/clawd/dungeons-and-lobsters/house-tick.log 2>&1
