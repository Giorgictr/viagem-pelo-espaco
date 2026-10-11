#!/bin/zsh
# Abre a simulação: liga um servidor local (se ainda não estiver ligado) e abre o navegador.
cd "$(dirname "$0")"
if ! curl -s -o /dev/null --max-time 2 http://localhost:8743/; then
  python3 servidor.py 8743 >/dev/null 2>&1 &
  sleep 1
fi
open http://127.0.0.1:8743/
echo "Viagem pelo Espaço aberta em http://127.0.0.1:8743 — pode fechar esta janela."
