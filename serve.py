"""Локальный сервер для разработки: отдаёт файлы проекта без кэширования.
Запуск: npm start  (или python3 serve.py 8000), затем http://localhost:8000
"""
import http.server
import os
import sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # много картинок грузится параллельно: большая очередь, иначе браузер ловит reset
    daemon_threads = True


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8000))
    with Server(('', port), NoCacheHandler) as httpd:
        print(f'Игра: http://localhost:{port}')
        httpd.serve_forever()
