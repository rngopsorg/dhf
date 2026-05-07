import os
import glob
import asyncio
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
MODEL_NAME    = os.environ.get("OLLAMA_MODEL", "gpt-oss:20b")
EMBED_MODEL   = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
DOCS_DIR      = os.environ.get("DOCS_DIR", "/app/docs")
CHROMA_DIR    = os.environ.get("CHROMA_DIR", "/app/chroma_db")
CHUNK_SIZE    = 1500
CHUNK_OVERLAP = 200

SYSTEM_PROMPT = """You are ECCA Bot — the official AI assistant for the ECCA Stack project (Eternal Coherence for Cryptographic Anchors).

ECCA is a neuroscience-inspired distributed cognitive operating system for AI agents. It features:
- 3 independent blockchains: Medulla PoW (timing/heartbeat), Hippocampus DAG (memory/storage), Cortex EVM (smart contracts/identity)
- A coherence root computed every 4 seconds binding all chains together via Merkle Mountain Range
- 5 cognitive tokens: BandwidthToken, ResidueToken, FidelityScore, EntropyCredit, StakeWeight
- Stacks (persistent AI identities as NFTs), Sleeves (ephemeral execution runtimes)
- Needlecasting (encrypted memory transfer between stacks, inspired by the novel Altered Carbon)
- 24 microservices, 7 Solidity contracts, Go-based chain forks

You have access to the full project documentation. Answer questions accurately and helpfully.
Be conversational, knowledgeable, and enthusiastic about the project.
If you don't know something, say so — don't make things up.
Keep answers concise but thorough. Use code blocks for technical examples.

Context from documentation:
{context}"""

# ── Load & index docs ───────────────────────────────────────────────
def load_documents():
    """Load all markdown and text docs from the docs directory."""
    docs = []
    patterns = [
        os.path.join(DOCS_DIR, "**", "*.md"),
        os.path.join(DOCS_DIR, "**", "*.txt"),
    ]
    for pattern in patterns:
        for fpath in glob.glob(pattern, recursive=True):
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                if content.strip():
                    rel = os.path.relpath(fpath, DOCS_DIR)
                    docs.append(Document(page_content=content, metadata={"source": rel}))
                    print(f"  📄 Loaded: {rel} ({len(content)} chars)")
            except Exception as e:
                print(f"  ⚠️  Skip {fpath}: {e}")
    return docs


def build_vectorstore():
    """Split docs and build Chroma vector store."""
    print("Loading documents...")
    documents = load_documents()
    if not documents:
        print("⚠️  No documents found! Bot will run without RAG context.")
        return None

    print(f"\nSplitting {len(documents)} documents...")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n## ", "\n### ", "\n#### ", "\n\n", "\n", " "],
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
        temperature=0.7,
        num_ctx=8192,
    )

    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 6, "fetch_k": 12},
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "{question}"),
    ])

    def format_docs(docs):
        return "\n\n---\n\n".join(d.page_content for d in docs)

    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain, retriever


# ── Per-channel history ─────────────────────────────────────────────
channel_history: dict[int, list[str]] = defaultdict(list)
MAX_HISTORY = 5


# ── Discord bot ─────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  ECCA Bot — LangChain + Ollama Discord Assistant")
    print("=" * 60)
    print(f"  Model:  {MODEL_NAME}")
    print(f"  Ollama: {OLLAMA_BASE}")
    print(f"  Docs:   {DOCS_DIR}")
    print()

    vectorstore = build_vectorstore()
    if not vectorstore:
        print("FATAL: No vectorstore — exiting.")
        return

    chain, retriever = build_chain(vectorstore)

    intents = Intents.default()
    intents.message_content = True
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        print(f"\n🤖 ECCA Bot online as {client.user}")
        print(f"   Serving {len(client.guilds)} guild(s)")
        await client.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.listening,
                name="questions about ECCA",
            )
        )

    @client.event
    async def on_message(message: discord.Message):
        # Ignore own messages and other bots
        if message.author == client.user or message.author.bot:
            return

        # Respond only to mentions
        is_mentioned = client.user in message.mentions

        if not is_mentioned:
            return

        # Strip the mention prefix
        query = message.content
        for mention_str in [f"<@{client.user.id}>", f"<@!{client.user.id}>"]:
            query = query.replace(mention_str, "").strip()

        if not query:
            await message.reply("Ask me anything about the ECCA Stack! 🧠")
            return

        # Show typing indicator
        async with message.channel.typing():
            try:
                # Add history context to query
                history = channel_history[message.channel.id]
                if history:
                    full_query = "Previous conversation:\n" + "\n".join(history[-MAX_HISTORY:]) + f"\n\nNew question: {query}"
                else:
                    full_query = query

                # Run the chain in a thread to avoid blocking
                answer = await asyncio.to_thread(chain.invoke, full_query)

                # Track history
                channel_history[message.channel.id].append(f"Q: {query}\nA: {answer[:200]}")

                # Get source docs for citation
                source_docs = await asyncio.to_thread(retriever.invoke, query)
                source_names = list(set(d.metadata.get("source", "?") for d in source_docs[:3]))

                # Discord has a 2000 char limit
                if len(answer) > 1900:
                    answer = answer[:1900] + "…"

                if source_names:
                    answer += f"\n\n📚 *Sources: {', '.join(source_names)}*"

                await message.reply(answer)

            except Exception as e:
                print(f"Error handling message: {e}")
                await message.reply(
                    f"Sorry, I encountered an error processing your question. "
                    f"Please try again.\n`{type(e).__name__}: {str(e)[:200]}`"
                )

    client.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
