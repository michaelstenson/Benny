"""Benny plugin for Hermes: Benny the agent's tools for Benny the app.

Every tool is in the "benny" toolset, so a platform gets them by listing
benny in platform_toolsets.
"""

from . import schemas, tools

TOOLS = [
    (schemas.TODAY, tools.today),
    (schemas.UPCOMING, tools.upcoming),
    (schemas.TODOS, tools.todos),
    (schemas.ADD_TODO, tools.add_todo),
    (schemas.ADD_TO_LIST, tools.add_to_list),
    (schemas.SET_TODO_DONE, tools.set_todo_done),
    (schemas.SEARCH_EMAIL, tools.search_email),
    (schemas.READ_EMAIL, tools.read_email),
    (schemas.READ_ATTACHMENT, tools.read_attachment),
    (schemas.PETS, tools.pets),
    (schemas.LOG_PET, tools.log_pet),
    (schemas.HOME, tools.home),
    (schemas.HOME_CONTROL, tools.home_control),
    (schemas.PROPOSE_EVENT, tools.propose_event),
    (schemas.PROPOSE_EMAIL_DRAFT, tools.propose_email_draft),
    (schemas.PROPOSALS, tools.proposals),
]


def register(ctx):
    for schema, handler in TOOLS:
        ctx.register_tool(name=schema["name"], toolset="benny", schema=schema, handler=handler)
