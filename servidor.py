# Servidor local da simulação: igual ao "python3 -m http.server", mas proíbe o navegador
# de guardar cópias antigas e atende tanto em 127.0.0.1 quanto em ::1 (o Safari usa este
# endereço para "localhost"). Só aceita conexões do próprio computador.
import http.server, socketserver, socket, sys, os, threading

class SemCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

class Servidor6(socketserver.ThreadingTCPServer):
    address_family = socket.AF_INET6

os.chdir(os.path.dirname(os.path.abspath(__file__)))
porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8743
socketserver.TCPServer.allow_reuse_address = True
servidores = [socketserver.ThreadingTCPServer(('127.0.0.1', porta), SemCache)]
try:
    servidores.append(Servidor6(('::1', porta), SemCache))
except OSError:
    pass
for s in servidores[1:]:
    threading.Thread(target=s.serve_forever, daemon=True).start()
servidores[0].serve_forever()
