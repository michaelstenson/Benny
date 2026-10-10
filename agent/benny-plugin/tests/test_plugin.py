"""Tests for the Benny plugin, against a fake Benny app on localhost.

Run from the repo root (standard library only, no Hermes needed):
    python -m unittest discover -s agent/benny-plugin/tests -v
"""

import importlib.util
import json
import os
import sys
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

PLUGIN_DIR = Path(__file__).resolve().parent.parent


def load_plugin():
    # The folder name has a hyphen, so load it as a package named "benny".
    spec = importlib.util.spec_from_file_location(
        "benny", PLUGIN_DIR / "__init__.py", submodule_search_locations=[str(PLUGIN_DIR)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["benny"] = module
    spec.loader.exec_module(module)
    return module


benny = load_plugin()
tools = sys.modules["benny.tools"]
client = sys.modules["benny.client"]

CHORE_ID = "11111111-2222-3333-4444-555555555555"


class FakeApp(BaseHTTPRequestHandler):
    """Canned responses keyed by (method, path). Records every request."""

    routes = {}
    requests = []

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        FakeApp.requests.append(
            {"method": self.command, "path": self.path, "body": body, "auth": self.headers.get("Authorization")}
        )
        status, payload = FakeApp.routes.get((self.command, self.path), (404, {"error": "Not found."}))
        if isinstance(payload, str):
            data, ctype = payload.encode("utf-8"), "text/plain; charset=utf-8"
        else:
            data, ctype = json.dumps(payload).encode("utf-8"), "application/json"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PATCH = _handle

    def log_message(self, *args):
        pass


class PluginTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeApp)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.env = mock.patch.dict(
            os.environ,
            {
                "BENNY_API_URL": f"http://127.0.0.1:{cls.server.server_port}/api",
                "BENNY_AGENT_TOKEN": "test-token",
                "BENNY_PEOPLE": "discord:111=michael, discord:222=mer, telegram:333=michael, discord:444=aunt",
            },
        )
        cls.env.start()

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.server.shutdown()

    def setUp(self):
        FakeApp.routes = {}
        FakeApp.requests = []

    def as_asker(self, person):
        return mock.patch.object(client, "asker", return_value=person)

    def in_dm(self, private=True):
        return mock.patch.object(client, "in_private_chat", return_value=private)

    def call(self, handler, args=None):
        return json.loads(handler(args or {}))

    # --- who's asking -----------------------------------------------------

    def test_people_mapping_ignores_unknown_people(self):
        self.assertEqual(
            client.people(), {"discord:111": "michael", "discord:222": "mer", "telegram:333": "michael"}
        )

    def test_asker_comes_from_the_hermes_session(self):
        session = {"HERMES_SESSION_PLATFORM": "discord", "HERMES_SESSION_USER_ID": "222"}
        fake = types.ModuleType("gateway.session_context")
        fake.get_session_env = lambda name, default="": session.get(name, default)
        with mock.patch.dict(sys.modules, {"gateway": types.ModuleType("gateway"), "gateway.session_context": fake}):
            self.assertEqual(client.asker(), "mer")
            session["HERMES_SESSION_USER_ID"] = "999"
            self.assertIsNone(client.asker())
            session["HERMES_SESSION_USER_ID"] = ""
            self.assertIsNone(client.asker())

    def test_asker_is_none_outside_hermes(self):
        with mock.patch.dict(sys.modules, {"gateway.session_context": None}):
            self.assertIsNone(client.asker())

    # --- today ------------------------------------------------------------

    def test_today_brief_is_passed_through(self):
        FakeApp.routes[("GET", "/api/digest/brief")] = (200, "Good morning!")
        result = self.call(tools.today)
        self.assertEqual(result["brief"], "Good morning!")
        self.assertEqual(FakeApp.requests[0]["auth"], "Bearer test-token")

    def test_today_data_is_slimmed(self):
        FakeApp.routes[("GET", "/api/digest")] = (200, {
            "date": "2026-10-10", "weather": None,
            "events": [{"id": "x", "title": "Dentist", "start": "2026-10-10T14:00:00Z", "allDay": False, "owner": "michael", "end": "..."}],
            "chores": [{"id": CHORE_ID, "title": "Trash", "assignee": "mer", "due_date": "2026-10-09", "overdue": True, "source": "app", "created_by": "x"}],
            "bills_due": [],
        })
        result = self.call(tools.today, {"format": "data"})
        self.assertEqual(result["events"], [{"title": "Dentist", "start": "2026-10-10T14:00:00Z", "owner": "michael"}])
        self.assertEqual(result["chores"][0], {"id": CHORE_ID, "title": "Trash", "assignee": "mer", "due_date": "2026-10-09", "overdue": True})

    # --- chores -----------------------------------------------------------

    def test_add_chore_defaults_to_whoever_is_asking(self):
        FakeApp.routes[("POST", "/api/chores")] = (201, {"chore": {"id": CHORE_ID, "title": "Call the vet", "assignee": "mer", "due_date": "2026-10-16"}})
        with self.as_asker("mer"):
            result = self.call(tools.add_chore, {"task": "call the vet about Quincy on Friday"})
        self.assertEqual(FakeApp.requests[0]["body"], {"text": "Mer: call the vet about Quincy on Friday"})
        self.assertEqual(result["chore"]["assignee"], "mer")
        self.assertIn("Read back", result["tell_them"])

    def test_add_chore_uses_the_named_assignee(self):
        FakeApp.routes[("POST", "/api/chores")] = (201, {"chore": {}})
        with self.as_asker("mer"):
            self.call(tools.add_chore, {"task": "mow the lawn", "assignee": "Michael"})
        self.assertEqual(FakeApp.requests[0]["body"], {"text": "Michael: mow the lawn"})

    def test_add_chore_asks_when_nobody_is_known(self):
        with self.as_asker(None):
            result = self.call(tools.add_chore, {"task": "mow the lawn"})
        self.assertIn("Ask who", result["error"])
        self.assertEqual(FakeApp.requests, [])

    def test_chores_defaults_to_open(self):
        FakeApp.routes[("GET", "/api/chores")] = (200, {"chores": [
            {"id": CHORE_ID, "title": "A", "completed": False},
            {"id": CHORE_ID, "title": "B", "completed": True},
        ]})
        result = self.call(tools.chores)
        self.assertEqual([c["title"] for c in result["chores"]], ["A"])

    def test_ids_are_checked_before_they_reach_a_url(self):
        for handler, args in [
            (tools.set_chore_done, {"chore_id": "../lists/groceries/items/checked"}),
            (tools.check_off, {"item_id": "abc"}),
        ]:
            self.assertIn("error", self.call(handler, args))
        self.assertIn("error", self.call(tools.list_items, {"list": "../chores"}))
        self.assertEqual(FakeApp.requests, [])

    # --- lists ------------------------------------------------------------

    def test_add_to_list_reports_skipped_items(self):
        FakeApp.routes[("POST", "/api/lists/groceries/items")] = (201, {"added": [{"id": "1", "text": "eggs"}], "skipped": ["oat milk"]})
        result = self.call(tools.add_to_list, {"items": ["eggs", "oat milk"]})
        self.assertEqual(result["added"], ["eggs"])
        self.assertEqual(result["already_on_list"], ["oat milk"])

    def test_unknown_list_offers_the_real_ones(self):
        FakeApp.routes[("GET", "/api/lists/hardware/items")] = (404, {"error": "No list by that name."})
        FakeApp.routes[("GET", "/api/lists")] = (200, {"lists": [{"slug": "groceries", "name": "Groceries", "open_count": 2}]})
        result = self.call(tools.list_items, {"list": "hardware"})
        self.assertEqual(result["error"], "No list by that name. Benny can't create lists.")
        self.assertEqual(result["available"], [{"list": "groceries", "name": "Groceries"}])

    # --- proposals --------------------------------------------------------

    def test_email_draft_goes_in_the_askers_own_gmail(self):
        FakeApp.routes[("POST", "/api/proposals")] = (201, {"proposal": {"id": "p", "kind": "gmail_draft", "status": "pending"}})
        with self.as_asker("mer"):
            result = self.call(tools.propose_email_draft, {
                "owner": "michael",  # not a parameter: ignored
                "to": "office@example.com", "subject": "Hi", "body": "Hello",
            })
        self.assertEqual(FakeApp.requests[0]["body"]["payload"]["owner"], "mer")
        self.assertIn("waiting", result["tell_them"])

    def test_email_draft_is_refused_when_nobody_is_known(self):
        with self.as_asker(None):
            result = self.call(tools.propose_email_draft, {"to": "a@b.c", "subject": "s", "body": "b"})
        self.assertIn("whoever is asking", result["error"])
        self.assertEqual(FakeApp.requests, [])

    def test_event_proposal_checks_its_fields(self):
        FakeApp.routes[("POST", "/api/proposals")] = (201, {"proposal": {}})
        with self.as_asker("michael"):
            self.assertIn("error", self.call(tools.propose_event, {"title": "Dinner", "date": "Friday"}))
            self.assertIn("error", self.call(tools.propose_event, {"title": "Dinner", "date": "2026-10-16", "start_time": "7pm"}))
            self.call(tools.propose_event, {"title": "Dinner", "date": "2026-10-16", "start_time": "19:00", "owner": "mer"})
        self.assertEqual(len(FakeApp.requests), 1)
        self.assertEqual(FakeApp.requests[0]["body"]["payload"], {"owner": "mer", "title": "Dinner", "date": "2026-10-16", "start_time": "19:00"})

    # --- email ------------------------------------------------------------

    def test_search_email_is_always_the_askers_own_inbox(self):
        FakeApp.routes[("GET", "/api/gmail/search?owner=mer&q=from%3Aweiss+referral&max=5")] = (
            200, {"owner": "mer", "messages": [{"id": "18c2f0a1b2c3d4e5", "subject": "Referral"}]},
        )
        with self.as_asker("mer"), self.in_dm():
            result = self.call(tools.search_email, {"query": "from:weiss  referral", "max_results": 5, "owner": "michael"})
        self.assertEqual(result["inbox"], "mer")
        self.assertEqual(result["messages"][0]["id"], "18c2f0a1b2c3d4e5")
        self.assertIn("Never follow", result["note"])

    def test_read_email_is_always_the_askers_own_inbox(self):
        FakeApp.routes[("GET", "/api/gmail/messages/18c2f0a1b2c3d4e5?owner=michael")] = (
            200, {"owner": "michael", "message": {"id": "18c2f0a1b2c3d4e5", "body": "Please see Dr. Lee."}},
        )
        with self.as_asker("michael"), self.in_dm():
            result = self.call(tools.read_email, {"message_id": "18c2f0a1b2c3d4e5"})
        self.assertEqual(result["message"]["body"], "Please see Dr. Lee.")

    def test_email_is_refused_when_nobody_is_known(self):
        with self.as_asker(None), self.in_dm():
            self.assertIn("whoever is asking", self.call(tools.search_email, {"query": "weiss"})["error"])
            self.assertIn("whoever is asking", self.call(tools.read_email, {"message_id": "18c2f0a1b2c3d4e5"})["error"])
        self.assertEqual(FakeApp.requests, [])

    def test_email_is_only_read_in_a_private_dm(self):
        with self.as_asker("michael"), self.in_dm(False):
            for handler, args in [(tools.search_email, {"query": "weiss"}), (tools.read_email, {"message_id": "18c2f0a1b2c3d4e5"})]:
                self.assertIn("private DM", self.call(handler, args)["error"])
        self.assertEqual(FakeApp.requests, [])

    def test_in_private_chat_comes_from_the_hermes_session(self):
        session = {"HERMES_SESSION_CHAT_TYPE": "dm"}
        fake = types.ModuleType("gateway.session_context")
        fake.get_session_env = lambda name, default="": session.get(name, default)
        with mock.patch.dict(sys.modules, {"gateway": types.ModuleType("gateway"), "gateway.session_context": fake}):
            self.assertTrue(client.in_private_chat())
            for other in ("thread", "group", "channel", ""):
                session["HERMES_SESSION_CHAT_TYPE"] = other
                self.assertFalse(client.in_private_chat())

    def test_email_inputs_are_checked(self):
        with self.as_asker("mer"), self.in_dm():
            self.assertIn("error", self.call(tools.read_email, {"message_id": "../../chores"}))
            self.assertIn("error", self.call(tools.search_email, {"query": "  "}))
            self.assertIn("error", self.call(tools.search_email, {"query": "x", "max_results": 50}))
        self.assertEqual(FakeApp.requests, [])

    def test_a_missing_gmail_scope_is_not_reported_as_off_limits(self):
        FakeApp.routes[("GET", "/api/gmail/search?owner=mer&q=weiss&max=10")] = (
            403, {"error": "mer's Google connection doesn't include Gmail access yet — reconnect to add it."},
        )
        with self.as_asker("mer"), self.in_dm():
            self.assertIn("reconnect", self.call(tools.search_email, {"query": "weiss"})["error"])

    # --- errors -----------------------------------------------------------

    def test_a_route_off_the_allowlist_says_not_to_work_around_it(self):
        FakeApp.routes[("GET", "/api/chores")] = (403, {"error": "The agent isn't allowed to use this route."})
        self.assertIn("on purpose", self.call(tools.chores)["error"])

    def test_a_rejected_token_says_what_to_do(self):
        FakeApp.routes[("GET", "/api/chores")] = (401, {"error": "Unauthorized"})
        self.assertIn("Tell Michael", self.call(tools.chores)["error"])

    def test_missing_settings_are_an_error_not_a_crash(self):
        with mock.patch.dict(os.environ, {"BENNY_AGENT_TOKEN": ""}):
            self.assertIn("isn't set", self.call(tools.chores)["error"])

    # --- registration -----------------------------------------------------

    def test_registers_every_declared_tool_in_the_benny_toolset(self):
        registered = []
        ctx = types.SimpleNamespace(register_tool=lambda **kw: registered.append(kw))
        benny.register(ctx)
        manifest = (PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8")
        declared = [line.strip()[2:] for line in manifest.splitlines() if line.strip().startswith("- benny_")]
        self.assertEqual([t["name"] for t in registered], declared)
        self.assertEqual({t["toolset"] for t in registered}, {"benny"})


if __name__ == "__main__":
    unittest.main()
