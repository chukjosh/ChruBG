"""Single process server for Docker or local use. Serves the web page and the API on one port."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PROJECT_ROOT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIRECTORY = os.path.join(PROJECT_ROOT_DIRECTORY, "public")
API_PATH = "/api/remove_background"
sys.path.insert(0, os.path.join(PROJECT_ROOT_DIRECTORY, "api"))

from remove_background import handler as api_handler  # noqa: E402


class LocalServerHandler(api_handler, SimpleHTTPRequestHandler):
    def __init__(self, *arguments, **keyword_arguments):
        super().__init__(*arguments, directory=PUBLIC_DIRECTORY, **keyword_arguments)

    def is_api_request(self):
        return self.path.split("?")[0] == API_PATH

    def do_GET(self):
        if self.is_api_request():
            api_handler.do_GET(self)
        else:
            SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.is_api_request():
            api_handler.do_POST(self)
        else:
            self.send_error(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"ChruBG running on http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), LocalServerHandler).serve_forever()
