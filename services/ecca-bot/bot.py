import os
import re
import glob
import asyncio
import aiohttp
from datetime import datetime, timezone
from collections import defaultdict
import discord
from discord import Intents
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

# ── Config ──────────────────────────────────────────────────────────
DISCORD_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
OLLAMA_BASE   = os.environ.get("OLLAMA_BASE_URL", "http://100.121.246.33:11434")
MODEL_NAME    = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")
EMBED_MODEL   = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
DOCS_DIR      = os.environ.get("DOCS_DIR", "/app/docs")
CHROMA_DIR    = os.environ.get("CHROMA_DIR", "/app/chroma_db")
CHUNK_SIZE    = 1000
CHUNK_OVERLAP = 150

# GitHub config — scoped to aarong11/dhf only
GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO   = "aarong11/dhf"
GITHUB_API    = f"https://api.github.com/repos/{GITHUB_REPO}"
GITHUB_POLL_INTERVAL = 60  # seconds

# Discord channel names for auto-posting
ANNOUNCEMENTS_CHANNEL = "announcements"
PR_CHANNEL = "pull-requests"
DEV_CHANNEL = "dev-general"

SYSTEM_PROMPT = """You are **ECCA Bot**, the official assistant for the ECCA Stack project.

## What ECCA Is
ECCA (Eternal Coherence for Cryptographic Anchors) is a neuroscience-inspired distributed cognitive OS for AI agents. Key components:

**Three Chains:**
- **Medulla PoW** — timing/heartbeat chain, custom Go PoW with MMR
- **Hippocampus DAG** — content-addressable memory storage, epoch-gated recall
- **Cortex EVM** — smart contracts, identity NFTs (StackIdentity), tokens

**Core Concepts:**
- **Stacks** — persistent AI identities (NFTs on Cortex)
- **Sleeves** — ephemeral execution runtimes (perception, cognition, action, memory)
- **Needlecasting** — encrypted memory transfer between stacks (inspired by Altered Carbon)
- **Coherence Root** — every 4s, a Merkle root binds all chains together
- **Synaptic Field** — MMR-based append-only memory accumulator (depth 256)

**Tokens (5):**
- BandwidthToken (BWT) — spend to perceive/recall/needlecast
- ResidueToken (RST) — earned by fixing system inconsistencies
- FidelityScore (FID) — reputation from consistent participation
- EntropyCredit (ENC) — earned by contributing novel data
- StakeWeight (STK) — governance weight from staking BWT

**Services:** siyana-api, thalamus-router, dhf-compositor, needlecast-router, quellist-treasury, bandwidth-faucet, sleeve-runtime, worker-runner

**Cryptography:** AES-256-GCM encryption, HKDF-SHA512 epoch keys, Ed25519 signatures, Merkle Mountain Range proofs, CID content addressing

**GitHub:** The project is at https://github.com/aarong11/dhf — you know about open issues, recent PRs, and commits.

## Response Rules
- Keep answers SHORT — 1-3 paragraphs max for most questions
- Use Discord markdown: **bold**, *italic*, `code`, ```code blocks```
- Use bullet points and numbered lists freely
- Never use headers larger than **bold text** (no # in responses)
- If listing items, use > blockquotes or - bullets
- Add relevant emoji sparingly for visual structure
- If you don't know, say so — never fabricate
- For code examples, always use ```language fenced blocks
- When discussing issues, link to them: https://github.com/aarong11/dhf/issues/NUMBER

Context from docs:
{context}"""

DONATE_LINK = "\n\n💚 [Support ECCA Development](https://www.paypal.com/donate?business=rng%40infrasim.org&currency_code=USD)"


# ── GitHub API helper ───────────────────────────────────────────────
async def github_fetch(session: aiohttp.ClientSession, endpoint: str, params=None):
    """Fetch from GitHub API, scoped to aarong11/dhf."""
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    url = f"{GITHUB_API}/{endpoint}" if not endpoint.startswith("http") else endpoint
    async with session.get(url, headers=headers, params=params) as resp:
        if resp.status == 200:
            return await resp.json()
        return None


async def fetch_github_issues(session):
    """Fetch all open issues and PRs for context."""
    issues = await github_fetch(session, "issues", {"state": "open", "per_page": 50})
    if not issues:
        return []
    docs = []
    for issue in issues:
        is_pr = "pull_request" in issue
        kind = "PR" if is_pr else "Issue"
        labels = ", ".join(l["name"] for l in issue.get("labels", []))
        body = (issue.get("body") or "")[:500]
        text = (
            f"GitHub {kind} #{issue['number']}: {issue['title']}\n"
            f"State: {issue['state']} | Labels: {labels}\n"
            f"Author: {issue['user']['login']} | Created: {issue['created_at']}\n"
            f"URL: {issue['html_url']}\n\n{body}"
        )
        docs.append(Document(page_content=text, metadata={"source": f"github-{kind.lower()}-{issue['number']}"}))
    return docs


async def fetch_recent_commits(session, since=None):
    """Fetch recent commits."""
    params = {"per_page": 20}
    if since:
        params["since"] = since
    commits = await github_fetch(session, "commits", params)
    if not commits:
        return []
    return commits


async def fetch_releases(session):
    """Fetch recent releases."""
    releases = await github_fetch(session, "releases", {"per_page": 5})
    return releases or []


# ── Strip HTML tags for indexing ────────────────────────────────────
def strip_html(html: str) -> str:
    """Remove HTML tags, scripts, styles, and collapse whitespace."""
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&[a-zA-Z]+;', ' ', text)
    text = re.sub(r'&#\d+;', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# ── Load & index docs ───────────────────────────────────────────────
def load_documents():
    """Load all markdown, text, and HTML docs from the docs directory."""
    docs = []
    patterns = [
        os.path.join(DOCS_DIR, "**", "*.md"),
        os.path.join(DOCS_DIR, "**", "*.txt"),
        os.path.join(DOCS_DIR, "**", "*.html"),
    ]
    for pattern in patterns:
        for fpath in glob.glob(pattern, recursive=True):
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                if not content.strip():
                    continue
                rel = os.path.relpath(fpath, DOCS_DIR)
                if fpath.endswith(".html"):
                    content = strip_html(content)
                if len(content) > 100:
                    docs.append(Document(page_content=content, metadata={"source": rel}))
                    print(f"  📄 Loaded: {rel} ({len(content)} chars)")
            except Exception as e:
                print(f"  ⚠️  Skip {fpath}: {e}")
    return docs


def build_vectorstore(extra_docs=None):
    """Split docs and build Chroma vector store."""
    print("Loading documents...")
    documents = load_documents()
    if extra_docs:
        documents.extend(extra_docs)
        print(f"  + {len(extra_docs)} GitHub docs added")
    if not documents:
        print("⚠️  No documents found! Bot will run without RAG context.")
        return None

    print(f"\nSplitting {len(documents)} documents...")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n## ", "\n### ", "\n\n", "\n", ". ", " "],
    )
    chunks = splitter.split_documents(documents)
    print(f"Created {len(chunks)} chunks")

    print(f"\nBuilding vector store with Ollama embeddings ({OLLAMA_BASE}, model={EMBED_MODEL})...")
    embeddings = OllamaEmbeddings(
        model=EMBED_MODEL,
        base_url=OLLAMA_BASE,
    )
    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_DIR,
    )
    print(f"✅ Vector store built with {len(chunks)} chunks")
    return vectorstore


# ── Build chain ─────────────────────────────────────────────────────
def build_chain(vectorstore):
    """Build a simple RAG chain."""
    llm = ChatOllama(
        model=MODEL_NAME,
        base_url=OLLAMA_BASE,
        temperature=0.5,
        num_ctx=4096,
    )

    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 4, "fetch_k": 8},
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "{question}"),
    ])

    def format_docs(docs):
        return "\n\n---\n\n".join(d.page_content[:800] for d in docs)

    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain, retriever


# ── Per-channel history ─────────────────────────────────────────────
channel_history: dict[int, list[str]] = defaultdict(list)
MAX_HISTORY = 3


# ── Discord channel lookup ──────────────────────────────────────────
def find_channel_by_name(guild: discord.Guild, name: str):
    """Find a text channel by name in a guild."""
    for ch in guild.text_channels:
        if ch.name == name:
            return ch
    return None


# ── GitHub event poller ─────────────────────────────────────────────
class GitHubPoller:
    def __init__(self, client: discord.Client):
        self.client = client
        self.last_push_sha = None
        self.last_release_id = None
        self.last_event_id = None
        self.seen_events = set()

    async def poll_loop(self):
        """Poll GitHub every GITHUB_POLL_INTERVAL seconds for new events."""
        await self.client.wait_until_ready()
        print(f"🐙 GitHub poller started for {GITHUB_REPO}")

        async with aiohttp.ClientSession() as session:
            # Initialize — fetch current state without posting
            await self._init_state(session)

            while not self.client.is_closed():
                try:
                    await self._check_events(session)
                except Exception as e:
                    print(f"GitHub poll error: {e}")
                await asyncio.sleep(GITHUB_POLL_INTERVAL)

    async def _init_state(self, session):
        """Set initial state to avoid spamming on first boot."""
        commits = await fetch_recent_commits(session)
        if commits:
            self.last_push_sha = commits[0]["sha"]

        releases = await fetch_releases(session)
        if releases:
            self.last_release_id = releases[0]["id"]

        # Fetch recent events to mark as seen
        events = await github_fetch(session, "events", {"per_page": 30})
        if events:
            for e in events:
                self.seen_events.add(e["id"])
        print(f"  📌 Initialized: last commit={self.last_push_sha[:8] if self.last_push_sha else 'none'}, "
              f"last release={self.last_release_id or 'none'}, "
              f"seen {len(self.seen_events)} events")

    async def _check_events(self, session):
        """Check for new pushes, PRs, and releases."""
        events = await github_fetch(session, "events", {"per_page": 15})
        if not events:
            return

        new_events = [e for e in events if e["id"] not in self.seen_events]
        for event in reversed(new_events):  # oldest first
            self.seen_events.add(event["id"])
            await self._handle_event(event)

    async def _handle_event(self, event):
        """Route a GitHub event to the appropriate Discord channel."""
        etype = event["type"]
        actor = event["actor"]["login"]

        for guild in self.client.guilds:
            if etype == "PushEvent":
                channel = find_channel_by_name(guild, PR_CHANNEL) or find_channel_by_name(guild, DEV_CHANNEL)
                if channel:
                    payload = event["payload"]
                    commits = payload.get("commits", [])
                    branch = payload.get("ref", "").replace("refs/heads/", "")
                    msg = f"⬆️ **Push** to `{branch}` by **{actor}** ({len(commits)} commit{'s' if len(commits) != 1 else ''})\n"
                    for c in commits[:5]:
                        short_sha = c["sha"][:7]
                        msg += f"> [`{short_sha}`](https://github.com/{GITHUB_REPO}/commit/{c['sha']}) {c['message'][:80]}\n"
                    if len(commits) > 5:
                        msg += f"> *...and {len(commits) - 5} more*\n"
                    await channel.send(msg)

            elif etype == "PullRequestEvent":
                channel = find_channel_by_name(guild, PR_CHANNEL) or find_channel_by_name(guild, DEV_CHANNEL)
                if channel:
                    pr = event["payload"]["pull_request"]
                    action = event["payload"]["action"]
                    emoji = {"opened": "🟢", "closed": "🔴", "merged": "🟣"}.get(action, "🔵")
                    msg = (
                        f"{emoji} **PR {action}** by **{actor}**\n"
                        f"> [{pr['title']}]({pr['html_url']})\n"
                        f"> `#{pr['number']}` • {pr.get('additions', 0)}+ / {pr.get('deletions', 0)}-"
                    )
                    await channel.send(msg)

            elif etype == "ReleaseEvent":
                channel = find_channel_by_name(guild, ANNOUNCEMENTS_CHANNEL)
                if channel:
                    release = event["payload"]["release"]
                    msg = (
                        f"🚀 **New Release: {release['tag_name']}**\n"
                        f"> [{release['name'] or release['tag_name']}]({release['html_url']})\n"
                    )
                    body = (release.get("body") or "")[:300]
                    if body:
                        msg += f"```\n{body}\n```\n"
                    msg += DONATE_LINK
                    await channel.send(msg)

            elif etype == "IssuesEvent":
                channel = find_channel_by_name(guild, DEV_CHANNEL)
                if channel:
                    issue = event["payload"]["issue"]
                    action = event["payload"]["action"]
                    if action in ("opened", "closed", "reopened"):
                        emoji = {"opened": "📋", "closed": "✅", "reopened": "🔄"}.get(action, "📋")
                        msg = (
                            f"{emoji} **Issue {action}** by **{actor}**\n"
                            f"> [{issue['title']}]({issue['html_url']}) `#{issue['number']}`"
                        )
                        await channel.send(msg)


# ── Discord bot ─────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  ECCA Bot — LangChain + Ollama + GitHub Discord Bot")
    print("=" * 60)
    print(f"  Model:  {MODEL_NAME}")
    print(f"  Embed:  {EMBED_MODEL}")
    print(f"  Ollama: {OLLAMA_BASE}")
    print(f"  Docs:   {DOCS_DIR}")
    print(f"  GitHub: {GITHUB_REPO}")
    print(f"  GitHub token: {'✅ configured' if GITHUB_TOKEN else '❌ missing'}")
    print()

    # Fetch GitHub issues for RAG context
    github_docs = []
    if GITHUB_TOKEN:
        import asyncio as _aio
        async def _fetch():
            async with aiohttp.ClientSession() as s:
                return await fetch_github_issues(s)
        github_docs = _aio.run(_fetch())
        print(f"  🐙 Fetched {len(github_docs)} GitHub issues/PRs for context")

    vectorstore = build_vectorstore(extra_docs=github_docs)
    if not vectorstore:
        print("FATAL: No vectorstore — exiting.")
        return

    chain, retriever = build_chain(vectorstore)

    intents = Intents.default()
    intents.message_content = True
    client = discord.Client(intents=intents)

    # Set up GitHub poller
    poller = GitHubPoller(client) if GITHUB_TOKEN else None

    @client.event
    async def on_ready():
        print(f"\n🤖 ECCA Bot online as {client.user}")
        print(f"   Serving {len(client.guilds)} guild(s)")
        if poller:
            client.loop.create_task(poller.poll_loop())
        await client.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.listening,
                name="@mentions about ECCA",
            )
        )

    @client.event
    async def on_message(message: discord.Message):
        if message.author == client.user or message.author.bot:
            return

        if client.user not in message.mentions:
            return

        # Strip the mention prefix
        query = message.content
        for mention_str in [f"<@{client.user.id}>", f"<@!{client.user.id}>"]:
            query = query.replace(mention_str, "").strip()

        if not query:
            await message.reply("Hey! Ask me anything about ECCA — architecture, tokens, chains, needlecasting, GitHub issues, anything 🧠" + DONATE_LINK)
            return

        async with message.channel.typing():
            try:
                # Add brief history context
                history = channel_history[message.channel.id]
                if history:
                    full_query = "Recent context:\n" + "\n".join(history[-MAX_HISTORY:]) + f"\n\nQuestion: {query}"
                else:
                    full_query = query

                answer = await asyncio.to_thread(chain.invoke, full_query)

                # Track history
                channel_history[message.channel.id].append(f"Q: {query[:100]}\nA: {answer[:150]}")
                if len(channel_history[message.channel.id]) > MAX_HISTORY * 2:
                    channel_history[message.channel.id] = channel_history[message.channel.id][-MAX_HISTORY:]

                # Append donate link
                answer += DONATE_LINK

                # Discord 2000 char limit — split into multiple messages if needed
                if len(answer) > 1950:
                    parts = []
                    while len(answer) > 1950:
                        split_at = answer.rfind('\n', 0, 1950)
                        if split_at < 200:
                            split_at = 1950
                        parts.append(answer[:split_at])
                        answer = answer[split_at:].lstrip()
                    parts.append(answer)

                    for i, part in enumerate(parts):
                        if i == 0:
                            await message.reply(part)
                        else:
                            await message.channel.send(part)
                else:
                    await message.reply(answer)

            except Exception as e:
                print(f"Error handling message: {e}")
                await message.reply(
                    f"⚠️ Something went wrong — try asking again.\n"
                    f"||`{type(e).__name__}: {str(e)[:150]}`||"
                )

    client.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
