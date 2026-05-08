#!/bin/bash
# Test hippocampus recall directly
curl -s -X POST http://localhost:15001/dhf/recall \
  -H "Content-Type: application/json" \
  -d '{"rootCid":"ecca://72aaf72d70e14cc2eb3bd70403ade1046fbc1abdc5fa468596757e96de09040c@0","stackId":"stack:human:1:d7b64df6f915","epoch":0,"depth":6,"memoryToken":250}'
echo
