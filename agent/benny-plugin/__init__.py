"""Benny plugin for Hermes: Benny the agent's tools for Benny the app.

Every tool is in the "benny" toolset, so a platform gets them by listing
benny in platform_toolsets.
"""

from . import schemas, tools

TOOLS = [
    (schemas.TODAY, tools.today),
    (schemas.UPCOMING, tools.upcoming),
    (schemas.CHORES, tools.chores),
    (schemas.ADD_CHORE, tools.add_chore),
    (schemas.SET_CHORE_DONE, tools.set_chore_done),
    (schemas.LIST_ITEMS, tools.list_items),
    (schemas.ADD_TO_LIST, tools.add_to_list),
    (schemas.CHECK_OFF, tools.check_off),
    (schemas.PROPOSE_EVENT, tools.propose_event),
    (schemas.PROPOSE_EMAIL_DRAFT, tools.propose_email_draft),
    (schemas.PROPOSALS, tools.proposals),
]


def register(ctx):
    for schema, handler in TOOLS:
        ctx.register_tool(name=schema["name"], toolset="benny", schema=schema, handler=handler)
