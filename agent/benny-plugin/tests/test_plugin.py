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
                "BENNY_HA_URL": f"http://127.0.0.1:{cls.server.server_port}",
                "BENNY_HA_TOKEN": "ha-token",
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
            "todos": [{"id": CHORE_ID, "title": "Trash", "list": "chores", "list_name": "Chores", "assignee": "mer", "due_date": "2026-10-09", "overdue": True}],
            "bills_due": [],
        })
        result = self.call(tools.today, {"format": "data"})
        self.assertEqual(result["events"], [{"title": "Dentist", "start": "2026-10-10T14:00:00Z", "owner": "michael"}])
        self.assertEqual(result["todos"][0], {"id": CHORE_ID, "title": "Trash", "list": "chores", "assignee": "mer", "due_date": "2026-10-09", "overdue": True})

    # --- to-dos -----------------------------------------------------------

    TODOS = {
        "today": "2026-10-16",
        "lists": [
            {"slug": "chores", "name": "Chores", "mode": "tasks", "open_count": 3},
            {"slug": "groceries", "name": "Groceries", "mode": "items", "open_count": 1},
        ],
        "todos": [
            {"id": "a", "title": "Trash", "list": "chores", "assignee": "mer", "due_date": "2026-10-14", "done": False, "created_at": "1"},
            {"id": "b", "title": "Vet", "list": "chores", "assignee": "michael", "due_date": None, "important": True, "my_day": "2026-10-16", "done": False, "created_at": "2"},
            {"id": "c", "title": "Plants", "list": "chores", "assignee": "michael", "due_date": "2026-10-20", "repeat": "weekly", "done": False, "created_at": "3"},
            {"id": "d", "title": "Eggs", "list": "groceries", "assignee": None, "due_date": None, "done": False, "created_at": "4"},
            {"id": "e", "title": "Milk", "list": "groceries", "assignee": None, "due_date": None, "done": True, "created_at": "5"},
        ],
        "move_tasks": [],
    }

    def test_todos_defaults_to_open_on_every_list_soonest_first(self):
        FakeApp.routes[("GET", "/api/todos")] = (200, self.TODOS)
        result = self.call(tools.todos)
        self.assertEqual([t["title"] for t in result["todos"]], ["Trash", "Plants", "Vet", "Eggs"])
        self.assertTrue(result["todos"][0]["overdue"])
        self.assertEqual(result["todos"][1]["repeat"], "weekly")
        self.assertEqual(result["lists"][1], {"list": "groceries", "name": "Groceries", "kind": "items"})

    def test_todos_filters(self):
        FakeApp.routes[("GET", "/api/todos")] = (200, self.TODOS)
        titles = lambda args: [t["title"] for t in self.call(tools.todos, args)["todos"]]
        self.assertEqual(titles({"list": "groceries", "status": "all"}), ["Eggs", "Milk"])
        self.assertEqual(titles({"list": "groceries", "status": "done"}), ["Milk"])
        self.assertEqual(titles({"person": "michael"}), ["Plants", "Vet"])
        self.assertEqual(titles({"view": "my_day"}), ["Vet"])
        self.assertEqual(titles({"view": "important"}), ["Vet"])
        self.assertEqual(titles({"view": "planned"}), ["Trash", "Plants"])
        my_day = self.call(tools.todos, {"view": "my_day"})["todos"][0]
        self.assertTrue(my_day["my_day"] and my_day["important"])

    def test_todos_unknown_list_offers_the_real_ones(self):
        FakeApp.routes[("GET", "/api/todos")] = (200, self.TODOS)
        result = self.call(tools.todos, {"list": "hardware"})
        self.assertEqual(result["error"], "No list called hardware. Benny can't create lists.")
        self.assertEqual([l["list"] for l in result["available"]], ["chores", "groceries"])

    def test_add_todo_hints_whoever_is_asking(self):
        FakeApp.routes[("POST", "/api/todos")] = (201, {"todo": {"id": CHORE_ID, "title": "Call the vet", "list": "chores", "assignee": "mer", "due_date": "2026-10-16"}})
        with self.as_asker("mer"):
            result = self.call(tools.add_todo, {"task": "call the vet about Quincy on Friday"})
        self.assertEqual(
            FakeApp.requests[0]["body"],
            {"text": "call the vet about Quincy on Friday", "list": "chores", "assignee_hint": "mer"},
        )
        self.assertEqual(result["todo"]["assignee"], "mer")
        self.assertIn("Read back", result["tell_them"])

    def test_add_todo_uses_the_named_assignee_and_list(self):
        FakeApp.routes[("POST", "/api/todos")] = (201, {"todo": {}})
        with self.as_asker("mer"):
            self.call(tools.add_todo, {"task": "mow the lawn", "assignee": "Michael", "list": "Yard"})
        self.assertEqual(FakeApp.requests[0]["body"], {"text": "mow the lawn", "list": "yard", "assignee_hint": "michael"})

    def test_add_todo_asks_when_nobody_is_known(self):
        with self.as_asker(None):
            result = self.call(tools.add_todo, {"task": "mow the lawn"})
        self.assertIn("Ask who", result["error"])
        self.assertEqual(FakeApp.requests, [])

    def test_add_todo_to_an_item_list_points_at_add_to_list(self):
        FakeApp.routes[("POST", "/api/todos")] = (400, {"error": "Groceries takes items as typed: send them to /api/lists/groceries/items."})
        with self.as_asker("mer"):
            result = self.call(tools.add_todo, {"task": "eggs", "list": "groceries"})
        self.assertEqual(result["error"], "groceries is an item list: use benny_add_to_list.")

    def test_done_on_a_repeating_todo_says_when_the_next_is_due(self):
        FakeApp.routes[("PATCH", f"/api/todos/{CHORE_ID}")] = (200, {"todo": {"id": CHORE_ID, "title": "Plants", "due_date": "2026-10-27", "repeat": "weekly"}, "rolled": True})
        result = self.call(tools.set_todo_done, {"todo_id": CHORE_ID})
        self.assertEqual(FakeApp.requests[0]["body"], {"done": True})
        self.assertIn("2026-10-27", result["tell_them"])

    def test_ids_are_checked_before_they_reach_a_url(self):
        for handler, args in [
            (tools.set_todo_done, {"todo_id": "../lists/groceries/items/checked"}),
            (tools.set_todo_done, {"todo_id": "abc"}),
            (tools.todos, {"list": "../chores"}),
            (tools.add_to_list, {"list": "../chores", "items": ["x"]}),
            (tools.add_todo, {"list": "../x", "task": "x"}),
        ]:
            self.assertIn("error", self.call(handler, args))
        self.assertEqual(FakeApp.requests, [])

    # --- lists ------------------------------------------------------------

    def test_add_to_list_reports_skipped_items(self):
        FakeApp.routes[("POST", "/api/lists/groceries/items")] = (201, {"added": [{"id": "1", "text": "eggs"}], "skipped": ["oat milk"]})
        result = self.call(tools.add_to_list, {"items": ["eggs", "oat milk"]})
        self.assertEqual(result["added"], ["eggs"])
        self.assertEqual(result["already_on_list"], ["oat milk"])

    def test_unknown_list_offers_the_real_ones(self):
        FakeApp.routes[("POST", "/api/lists/hardware/items")] = (404, {"error": "No list by that name."})
        FakeApp.routes[("GET", "/api/lists")] = (200, {"lists": [{"slug": "groceries", "name": "Groceries", "mode": "items", "open_count": 2}]})
        result = self.call(tools.add_to_list, {"list": "hardware", "items": ["nails"]})
        self.assertEqual(result["error"], "No list by that name. Benny can't create lists.")
        self.assertEqual(result["available"], [{"list": "groceries", "name": "Groceries", "kind": "items"}])

    # --- pets -------------------------------------------------------------

    PET_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    PETS = {
        "today": "2026-10-16",
        "departure": {"date": "2027-09-20", "confirmed": False},
        "pets": [
            {
                "id": PET_ID, "name": "Quincy", "species": "dog", "age": "5 years", "travels": True,
                "microchip_number": "985112004567890", "breed": None, "caretaker": "mer",
                "latest_weight": {"weight_lb": 61.4, "on": "2026-10-10"},
                "vaccinations": [{"vaccine": "Rabies", "rabies": True, "given_on": "2026-07-01", "valid_until": "2029-07-01", "batch": "B456"}],
                "visits": [{"visited_on": "2026-10-10", "reason": "Annual exam", "weight_lb": 61.4}],
                "medications": [
                    {"name": "Heartgard", "dose": "1 chew", "every": "monthly", "next_due": "2026-11-01", "active": True},
                    {"name": "Antibiotic", "every": "daily", "ends_on": "2026-09-01", "active": False},
                ],
                "due": [{"id": "t", "title": "Quincy: Heartgard (1 chew)", "due_date": "2026-11-01"}],
                "travel": {"ready": False, "items": [
                    {"status": "ok", "text": "ISO chip 985112004567890."},
                    {"status": "todo", "text": "Add the date the chip went in."},
                    {"status": "info", "text": "EU health certificate: ..."},
                ]},
            },
            {"id": "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", "name": "Morticia", "species": "turtle", "travels": False,
             "vaccinations": [], "visits": [], "medications": [], "due": [], "travel": None},
        ],
    }

    def test_pets_summary_is_slim_and_lists_what_to_fix(self):
        FakeApp.routes[("GET", "/api/pets")] = (200, self.PETS)
        result = self.call(tools.pets)
        quincy, morticia = result["pets"]
        self.assertEqual(quincy["rabies"], {"given_on": "2026-07-01", "valid_until": "2029-07-01"})
        self.assertEqual(quincy["meds"], [{"name": "Heartgard", "dose": "1 chew", "every": "monthly", "next_due": "2026-11-01"}])
        self.assertEqual(quincy["eu_travel"], {"ready": False, "to_fix": ["Add the date the chip went in."]})
        self.assertNotIn("breed", quincy)
        self.assertEqual(morticia, {"name": "Morticia", "species": "turtle", "meds": [], "due": [], "moving": False})

    def test_one_pet_by_name_has_its_history(self):
        FakeApp.routes[("GET", "/api/pets")] = (200, self.PETS)
        quincy = self.call(tools.pets, {"pet": "quincy"})["pet"]
        self.assertEqual(quincy["vaccinations"][0]["batch"], "B456")
        self.assertEqual(len(quincy["medications"]), 2)
        self.assertEqual(len(quincy["eu_travel"]["all"]), 3)
        missing = self.call(tools.pets, {"pet": "Rex"})
        self.assertEqual(missing["error"], "No pet called Rex.")
        self.assertEqual(missing["pets"], ["Quincy", "Morticia"])

    def test_log_a_visit(self):
        FakeApp.routes[("GET", "/api/pets")] = (200, self.PETS)
        FakeApp.routes[("POST", f"/api/pets/{self.PET_ID}/visits")] = (201, {"visit": {}, "reminder": None})
        result = self.call(tools.log_pet, {"pet": "Quincy", "kind": "visit", "date": "2026-10-10", "reason": " Annual  exam", "weight_lb": 61.4})
        self.assertEqual(FakeApp.requests[-1]["body"], {"visited_on": "2026-10-10", "reason": "Annual exam", "weight_lb": 61.4})
        self.assertIsNone(result["reminder"])
        self.assertIn("Read back", result["tell_them"])

    def test_log_a_rabies_shot_returns_its_reminder(self):
        FakeApp.routes[("GET", "/api/pets")] = (200, self.PETS)
        FakeApp.routes[("POST", f"/api/pets/{self.PET_ID}/vaccinations")] = (
            201, {"vaccination": {}, "reminder": {"id": "x", "title": "Quincy: rabies due", "due_date": "2029-06-17", "repeat": None}}
        )
        result = self.call(tools.log_pet, {
            "pet": "Quincy", "kind": "vaccination", "vaccine": "Rabies", "date": "2026-07-01",
            "valid_until": "2029-07-01", "batch": "B456",
        })
        self.assertEqual(FakeApp.requests[-1]["body"], {
            "vaccine": "Rabies", "given_on": "2026-07-01", "rabies": True, "batch": "B456", "valid_until": "2029-07-01",
        })
        self.assertEqual(result["reminder"], {"title": "Quincy: rabies due", "due_date": "2029-06-17"})
        self.assertNotIn("rabies", result["logged"])

    def test_log_pet_checks_its_inputs_before_calling_the_app(self):
        bad = [
            {"pet": "Quincy", "kind": "surgery"},
            {"kind": "visit", "date": "2026-10-10", "reason": "x"},
            {"pet": "Quincy", "kind": "visit", "date": "10/10/2026", "reason": "x"},
            {"pet": "Quincy", "kind": "visit", "date": "2026-10-10"},
            {"pet": "Quincy", "kind": "visit", "date": "2026-10-10", "reason": "x", "weight_lb": "heavy"},
            {"pet": "Quincy", "kind": "vaccination", "vaccine": "Rabies"},
            {"pet": "Quincy", "kind": "medication", "name": "Heartgard", "every": "hourly"},
        ]
        for args in bad:
            self.assertIn("error", self.call(tools.log_pet, args), args)
        self.assertEqual(FakeApp.requests, [])

    def test_log_pet_for_an_unknown_pet_lists_the_real_ones(self):
        FakeApp.routes[("GET", "/api/pets")] = (200, self.PETS)
        result = self.call(tools.log_pet, {"pet": "Rex", "kind": "visit", "date": "2026-10-10", "reason": "x"})
        self.assertEqual(result["pets"], ["Quincy", "Morticia"])
        self.assertEqual([r["method"] for r in FakeApp.requests], ["GET"])

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

    def test_read_attachment_is_always_the_askers_own_inbox(self):
        FakeApp.routes[("GET", "/api/gmail/messages/18c2f0a1b2c3d4e5/attachments/0?owner=mer")] = (
            200, {"owner": "mer", "attachment": {"filename": "referral.pdf", "text": "Refer to: Dr. Lee", "truncated": False}},
        )
        with self.as_asker("mer"), self.in_dm():
            result = self.call(tools.read_attachment, {"message_id": "18c2f0a1b2c3d4e5", "index": 0, "owner": "michael"})
        self.assertEqual(result["inbox"], "mer")
        self.assertEqual(result["attachment"]["text"], "Refer to: Dr. Lee")
        self.assertIn("double-check", result["note"])

    def test_read_attachment_checks_its_inputs_and_where_it_is(self):
        with self.as_asker("mer"), self.in_dm():
            for args in [{"message_id": "nope", "index": 0}, {"message_id": "18c2f0a1b2c3d4e5", "index": -1},
                         {"message_id": "18c2f0a1b2c3d4e5", "index": "0"}, {"message_id": "18c2f0a1b2c3d4e5", "index": True}]:
                self.assertIn("error", self.call(tools.read_attachment, args))
        with self.as_asker("mer"), self.in_dm(False):
            self.assertIn("private DM", self.call(tools.read_attachment, {"message_id": "18c2f0a1b2c3d4e5", "index": 0})["error"])
        self.assertEqual(FakeApp.requests, [])

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

    # --- smart home -------------------------------------------------------

    HA_STATES = [
        {"entity_id": "light.kitchen_kitchen", "state": "on", "attributes": {"friendly_name": "Kitchen", "brightness": 128, "is_hue_group": True}},
        {"entity_id": "light.kitchen_kitchen_1", "state": "off", "attributes": {"friendly_name": "Kitchen 1"}},
        {"entity_id": "cover.reys_room_rey_west", "state": "open", "attributes": {"friendly_name": "Rey’s Room Rey West", "current_position": 100}},
        {"entity_id": "cover.joshs_room_josh_north", "state": "unavailable", "attributes": {"friendly_name": "Josh’s Room Josh North"}},
        {"entity_id": "sensor.reys_room_rey_west_battery", "state": "82", "attributes": {}},
        {"entity_id": "switch.wemo_mini", "state": "off", "attributes": {"friendly_name": "Wemo Mini"}},
        {"entity_id": "scene.kitchen_kitchen_relax", "state": "unknown", "attributes": {"friendly_name": "Kitchen Relax"}},
        {"entity_id": "lock.front_door", "state": "locked", "attributes": {"friendly_name": "Front door"}},
        {"entity_id": "automation.morning", "state": "on", "attributes": {"friendly_name": "Morning"}},
    ]

    def with_ha_states(self):
        FakeApp.routes[("GET", "/api/states")] = (200, self.HA_STATES)

    def posts(self):
        return [r for r in FakeApp.requests if r["method"] == "POST"]

    def test_home_lists_devices_but_not_scenes_locks_or_automations(self):
        self.with_ha_states()
        result = self.call(tools.home)
        self.assertEqual([d["id"] for d in result["devices"]], [
            "cover.joshs_room_josh_north", "cover.reys_room_rey_west",
            "light.kitchen_kitchen", "light.kitchen_kitchen_1", "switch.wemo_mini",
        ])
        self.assertEqual(result["devices"][1], {"id": "cover.reys_room_rey_west", "name": "Rey’s Room Rey West", "state": "open", "position": 100, "battery": 82})
        self.assertEqual(result["devices"][2], {"id": "light.kitchen_kitchen", "name": "Kitchen", "state": "on", "brightness": 50, "group": True})
        self.assertIn("unavailable", result["note"])
        self.assertEqual(FakeApp.requests[0]["auth"], "Bearer ha-token")

    def test_home_filters_by_room_and_kind(self):
        self.with_ha_states()
        self.assertEqual([d["id"] for d in self.call(tools.home, {"room": "Rey's room"})["devices"]], ["cover.reys_room_rey_west"])
        self.assertEqual([d["id"] for d in self.call(tools.home, {"kind": "scene"})["devices"]], ["scene.kitchen_kitchen_relax"])
        self.assertIn("Nothing matched", self.call(tools.home, {"room": "garage"})["note"])
        self.assertIn("error", self.call(tools.home, {"kind": "lock"}))

    def test_home_control_sends_one_call_per_kind_of_device(self):
        self.with_ha_states()
        FakeApp.routes[("POST", "/api/services/light/turn_off")] = (200, [])
        FakeApp.routes[("POST", "/api/services/switch/turn_off")] = (200, [])
        with self.as_asker("mer"):
            result = self.call(tools.home_control, {"ids": ["light.kitchen_kitchen", "switch.wemo_mini", "light.kitchen_kitchen"], "action": "off"})
        self.assertEqual([(r["path"], r["body"]) for r in self.posts()], [
            ("/api/services/light/turn_off", {"entity_id": ["light.kitchen_kitchen"]}),
            ("/api/services/switch/turn_off", {"entity_id": ["switch.wemo_mini"]}),
        ])
        self.assertEqual(result["devices"], ["Kitchen", "Wemo Mini"])
        self.assertEqual(self.posts()[0]["auth"], "Bearer ha-token")

    def test_home_control_brightness_and_color(self):
        self.with_ha_states()
        FakeApp.routes[("POST", "/api/services/light/turn_on")] = (200, [])
        with self.as_asker("michael"):
            self.call(tools.home_control, {"ids": ["light.kitchen_kitchen"], "action": "on", "brightness": 40, "color": "Dark  Blue"})
            self.call(tools.home_control, {"ids": ["light.kitchen_kitchen"], "action": "on", "color": "warm white"})
        self.assertEqual([r["body"] for r in self.posts()], [
            {"entity_id": ["light.kitchen_kitchen"], "brightness_pct": 40, "color_name": "darkblue"},
            {"entity_id": ["light.kitchen_kitchen"], "color_temp_kelvin": 2700},
        ])

    def test_home_control_shade_position_says_its_on_its_way(self):
        self.with_ha_states()
        FakeApp.routes[("POST", "/api/services/cover/set_cover_position")] = (200, [])
        with self.as_asker("mer"):
            self.assertIn("error", self.call(tools.home_control, {"ids": ["cover.reys_room_rey_west"], "action": "position"}))
            result = self.call(tools.home_control, {"ids": ["cover.reys_room_rey_west"], "action": "position", "position": 30})
        self.assertEqual(self.posts()[0]["body"], {"entity_id": ["cover.reys_room_rey_west"], "position": 30})
        self.assertIn("on its way", result["tell_them"])

    def test_home_control_refuses_what_it_shouldnt_touch(self):
        self.with_ha_states()
        with self.as_asker("michael"):
            for args in [
                {"ids": ["lock.front_door"], "action": "off"},
                {"ids": ["automation.morning"], "action": "off"},
                {"ids": ["light.not_a_real_light"], "action": "on"},
                {"ids": ["light.kitchen_kitchen"], "action": "open"},
                {"ids": ["cover.joshs_room_josh_north"], "action": "close"},
                {"ids": ["switch.wemo_mini"], "action": "on", "brightness": 50},
                {"ids": ["light.kitchen_kitchen"], "action": "on", "color": "#ff0000"},
                {"ids": ["../api/services"], "action": "on"},
                {"ids": "light.kitchen_kitchen", "action": "on"},
                {"ids": ["light.kitchen_kitchen"], "action": "restart"},
            ]:
                self.assertIn("error", self.call(tools.home_control, args), args)
        self.assertEqual(self.posts(), [])

    def test_home_control_needs_to_know_whos_asking(self):
        self.with_ha_states()
        with self.as_asker(None):
            self.assertIn("who's asking", self.call(tools.home_control, {"ids": ["light.kitchen_kitchen"], "action": "off"})["error"])
        self.assertEqual(FakeApp.requests, [])

    def test_home_errors_say_what_to_do(self):
        FakeApp.routes[("GET", "/api/states")] = (401, {"message": "Unauthorized"})
        self.assertIn("Tell Michael", self.call(tools.home)["error"])
        with mock.patch.dict(os.environ, {"BENNY_HA_TOKEN": ""}):
            self.assertIn("isn't set", self.call(tools.home)["error"])

    def test_home_assistant_refusals_come_back_as_its_message(self):
        self.with_ha_states()
        FakeApp.routes[("POST", "/api/services/light/turn_on")] = (400, {"message": "Invalid color name: pinkish"})
        with self.as_asker("mer"):
            result = self.call(tools.home_control, {"ids": ["light.kitchen_kitchen"], "action": "on", "color": "pinkish"})
        self.assertEqual(result["error"], "Invalid color name: pinkish")

    # --- errors -----------------------------------------------------------

    def test_a_route_off_the_allowlist_says_not_to_work_around_it(self):
        FakeApp.routes[("GET", "/api/todos")] = (403, {"error": "The agent isn't allowed to use this route."})
        self.assertIn("on purpose", self.call(tools.todos)["error"])

    def test_a_rejected_token_says_what_to_do(self):
        FakeApp.routes[("GET", "/api/todos")] = (401, {"error": "Unauthorized"})
        self.assertIn("Tell Michael", self.call(tools.todos)["error"])

    def test_missing_settings_are_an_error_not_a_crash(self):
        with mock.patch.dict(os.environ, {"BENNY_AGENT_TOKEN": ""}):
            self.assertIn("isn't set", self.call(tools.todos)["error"])

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
