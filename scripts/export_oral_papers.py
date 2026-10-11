#!/usr/bin/env python3
"""Export oral papers from PriorReview PostgreSQL and optionally download PDFs.

The manifest contains the paper metadata and all review/meta-review/comment
records already present in the database. PDF files are fetched from OpenReview
using the paper's forum id. Downloads are resumable: existing non-empty files
are skipped unless --force is supplied.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg
from psycopg.rows import dict_row


PAPER_SQL = """
SELECT id, conference, year, forum_id, paper_number, title, decision,
       decision_source, filename
FROM public.papers
WHERE conference IN ('ICLR', 'NeurIPS')
  AND lower(decision) LIKE '%oral%'
ORDER BY conference, year, id
"""

REVIEW_SQL = """
SELECT id, paper_id, note_id, reviewer_id, summary, review_text, strengths,
       weaknesses, questions, rating_raw, rating_numeric, rating_max,
       rating_normalized, confidence_raw, confidence_numeric, confidence_max,
       soundness, presentation, contribution, novelty, empirical_novelty,
       ethics_flag, ethics_concerns, extra_fields, created_at, modified_at
FROM public.reviews WHERE paper_id = %s ORDER BY id
"""

META_SQL = """
SELECT id, paper_id, note_id, ac_id, meta_text, additional_comments,
       reviewer_concerns, reviewer_scores, justification_higher,
       justification_lower, recommendation, ac_confidence_raw, ac_confidence_num,
       created_at, modified_at
FROM public.meta_reviews WHERE paper_id = %s ORDER BY id
"""

COMMENTS_SQL = """
SELECT id, paper_id, note_id, reply_to, author_id, author_role, title,
       comment_text, created_at, modified_at
FROM public.comments WHERE paper_id = %s ORDER BY id
"""


def login_openreview() -> str | None:
    """Log in with API credentials and return the session Cookie header."""
    username = os.getenv("OPENREVIEW_USERNAME")
    password = os.getenv("OPENREVIEW_PASSWORD")
    if not username or not password:
        return None
    payload = json.dumps({"id": username, "password": password}).encode("utf-8")
    req = Request("https://api2.openreview.net/login", data=payload, method="POST", headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "PriorReview oral-paper downloader/1.0"})
    with urlopen(req, timeout=30) as response:
        cookies = response.headers.get_all("Set-Cookie") or []
    return "; ".join(x.split(";", 1)[0] for x in cookies if "=" in x)


def resolve_pdf_url(forum_id: str) -> str | None:
    """Find the submission note PDF under a forum when forum_id is not itself a PDF id."""
    cookie = os.getenv("OPENREVIEW_COOKIE")
    if not cookie:
        return None
    req = Request(
        f"https://api.openreview.net/notes?forum={forum_id}&limit=100",
        headers={"Cookie": cookie, "Accept": "application/json", "User-Agent": "PriorReview oral-paper downloader/1.0"},
    )
    with urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    for note in payload.get("notes", []):
        content = note.get("content") or {}
        pdf = content.get("pdf") or note.get("pdf")
        if isinstance(pdf, str) and pdf:
            # V1 notes store attachments as /pdf/<attachment-filename>.
            return f"https://api.openreview.net{pdf if pdf.startswith('/') else '/' + pdf}"
    return None


def load_env_file(path: Path) -> None:
    """Load simple KEY=VALUE pairs without overwriting existing variables."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def db_connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.getenv("PRIORREVIEW_DB_HOST", "127.0.0.1"),
        port=int(os.getenv("PRIORREVIEW_DB_PORT", "5432")),
        user=os.getenv("PRIORREVIEW_DB_USER", "postgres"),
        password=os.getenv("PRIORREVIEW_DB_PASSWORD", ""),
        dbname=os.getenv("PRIORREVIEW_DB_NAME", "priorreview_analysis"),
        connect_timeout=15,
        row_factory=dict_row,
    )


def slug(value: str, max_len: int = 90) -> str:
    value = re.sub(r"[^\w\-\u4e00-\u9fff ]+", "", value or "")
    value = re.sub(r"\s+", "_", value).strip("_.")
    return (value or "untitled")[:max_len]


def fetch_json(cur: psycopg.Cursor, sql: str, paper_id: int) -> list[dict[str, Any]]:
    cur.execute(sql, (paper_id,))
    return [dict(x) for x in cur.fetchall()]


def build_manifest() -> list[dict[str, Any]]:
    with db_connect() as conn, conn.cursor() as cur:
        cur.execute(PAPER_SQL)
        papers = []
        for paper in cur.fetchall():
            p = dict(paper)
            # API v2 is the documented PDF endpoint and accepts the
            # openreview.accessToken cookie; the web endpoint may return a
            # browser-verification page to automated clients.
            p["pdf_url"] = f"https://api2.openreview.net/pdf?id={p['forum_id']}"
            p["pdf_url_web"] = f"https://openreview.net/pdf?id={p['forum_id']}"
            p["forum_url"] = f"https://openreview.net/forum?id={p['forum_id']}"
            p["reviews"] = fetch_json(cur, REVIEW_SQL, p["id"])
            p["meta_reviews"] = fetch_json(cur, META_SQL, p["id"])
            p["comments"] = fetch_json(cur, COMMENTS_SQL, p["id"])
            papers.append(p)
    return papers


def download(url: str, target: Path, timeout: int, retries: int, force: bool) -> tuple[str, str | None]:
    if target.exists() and target.stat().st_size > 0 and not force:
        return "skipped_existing", None
    target.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(retries + 1):
        try:
            headers = {"User-Agent": "PriorReview oral-paper downloader/1.0", "Accept": "application/pdf,*/*"}
            # OpenReview may require an authenticated/session cookie in some
            # environments. Keep it out of the manifest and read it only at run time.
            if os.getenv("OPENREVIEW_COOKIE"):
                headers["Cookie"] = os.environ["OPENREVIEW_COOKIE"]
            req = Request(url, headers=headers)
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
            if not data.startswith(b"%PDF"):
                raise RuntimeError(f"response is not a PDF (content-type={response.headers.get('content-type')})")
            target.write_bytes(data)
            return "downloaded", None
        except HTTPError as exc:
            if exc.code == 404 and url.startswith("https://api2.openreview.net/pdf?id="):
                forum_id = url.rsplit("=", 1)[-1]
                try:
                    resolved = resolve_pdf_url(forum_id)
                    if resolved and resolved != url:
                        url = resolved
                        continue
                except Exception as resolve_exc:
                    last_error = f"{type(resolve_exc).__name__}: {resolve_exc}"
            last_error = f"HTTPError: {exc}"
            if attempt < retries:
                time.sleep(2 ** attempt)
        except (URLError, TimeoutError, RuntimeError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < retries:
                time.sleep(2 ** attempt)
    return "failed", last_error


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path, default=Path("data/oral_papers"))
    ap.add_argument("--manifest", type=Path, default=Path("data/oral_papers.json"))
    ap.add_argument("--download", action="store_true", help="also download PDFs")
    ap.add_argument("--limit", type=int, default=0, help="only process the first N papers")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--env-file", type=Path, default=None, help="local KEY=VALUE config file")
    args = ap.parse_args()

    if args.env_file:
        load_env_file(args.env_file)

    if os.getenv("OPENREVIEW_USERNAME") and os.getenv("OPENREVIEW_PASSWORD"):
        try:
            cookie = login_openreview()
            if cookie:
                os.environ["OPENREVIEW_COOKIE"] = cookie
                print("OpenReview account login succeeded")
        except Exception as exc:
            print(f"OpenReview account login failed: {type(exc).__name__}: {exc}")

    papers = build_manifest()
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "count": len(papers), "papers": papers}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(papers)} papers to {args.manifest}")

    selected = papers[: args.limit] if args.limit > 0 else papers
    counts: dict[str, int] = {}
    for index, paper in enumerate(selected, 1):
        # The requested top-level name is NIPS; the database uses NeurIPS.
        conference_dir = "NIPS" if paper["conference"] == "NeurIPS" else "ICLR"
        folder = args.output / conference_dir / str(paper["year"]) / f"{paper['id']}_{slug(paper['title'])}"
        pdf_path = folder / "paper.pdf"
        status, error = download(paper["pdf_url"], pdf_path, args.timeout, args.retries, args.force) if args.download else ("not_requested", None)
        counts[status] = counts.get(status, 0) + 1
        review_data = {"paper_id": paper["id"], "forum_id": paper["forum_id"], "reviews": paper["reviews"], "meta_reviews": paper["meta_reviews"], "comments": paper["comments"]}
        record = {"paper": {k: v for k, v in paper.items() if k not in {"reviews", "meta_reviews", "comments"}}, "pdf_path": str(pdf_path), "pdf_status": status, "pdf_error": error, "reviews_path": str(folder / "reviews.json")}
        (folder / "record.json").parent.mkdir(parents=True, exist_ok=True)
        (folder / "record.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        (folder / "reviews.json").write_text(json.dumps(review_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[{index}/{len(selected)}] {paper['conference']} {paper['year']} #{paper['id']} {status}")
    print("Download summary:", json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
