from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from .models import Candidate, Contest, ElectionRecord, Jurisdiction

CLOSE_RACE_THRESHOLD_PCT = 2.0
LOW_TURNOUT_THRESHOLD_PCT = 45.0
HIGH_TURNOUT_THRESHOLD_PCT = 75.0


@dataclass(frozen=True)
class ContestRollup:
    office: str
    total_votes: int
    winner: Candidate | None
    second: Candidate | None
    margin_pct: float | None
    is_close: bool


def _contest_totals(contest: Contest) -> tuple[int, list[tuple[Candidate, int]]]:
    ranked: list[tuple[Candidate, int]] = sorted(
        [(c, c.votes) for c in contest.candidates], key=lambda x: x[1], reverse=True
    )
    total = sum(v for _, v in ranked)
    return total, ranked


def rollup_contest(contest: Contest) -> ContestRollup:
    total, ranked = _contest_totals(contest)
    if total == 0 or not ranked:
        return ContestRollup(
            office=contest.office,
            total_votes=0,
            winner=None,
            second=None,
            margin_pct=None,
            is_close=False,
        )
    winner_v = ranked[0][1]
    second_v = ranked[1][1] if len(ranked) > 1 else 0
    margin = ((winner_v - second_v) / total) * 100 if total else None
    is_close = margin is not None and margin < CLOSE_RACE_THRESHOLD_PCT
    return ContestRollup(
        office=contest.office,
        total_votes=total,
        winner=ranked[0][0],
        second=ranked[1][0] if len(ranked) > 1 else None,
        margin_pct=margin,
        is_close=is_close,
    )


def aggregate_office_across_jurisdictions(
    election: ElectionRecord, office: str
) -> tuple[int, dict[str, int]]:
    """Sum votes per candidate name+party for an office across all jurisdictions."""
    totals: dict[str, int] = defaultdict(int)
    grand = 0
    for j in election.jurisdictions:
        for c in j.contests:
            if c.office != office:
                continue
            for cand in c.candidates:
                key = f"{cand.name}|{cand.party}"
                totals[key] += cand.votes
                grand += cand.votes
    return grand, dict(totals)


def build_office_leaderboard(
    election: ElectionRecord, office: str
) -> list[dict[str, Any]]:
    grand, raw = aggregate_office_across_jurisdictions(election, office)
    if grand == 0:
        return []
    rows: list[dict[str, Any]] = []
    for key, votes in sorted(raw.items(), key=lambda x: x[1], reverse=True):
        name, party = key.split("|", 1)
        pct = (votes / grand) * 100
        rows.append(
            {
                "name": name,
                "party": party,
                "votes": votes,
                "vote_share_pct": round(pct, 2),
            }
        )
    return rows


def jurisdiction_turnout_pct(j: Jurisdiction) -> float | None:
    if j.registered_voters and j.registered_voters > 0 and j.ballots_cast is not None:
        return (j.ballots_cast / j.registered_voters) * 100
    return None


def compute_overall_turnout(election: ElectionRecord) -> float | None:
    reg = sum(j.registered_voters or 0 for j in election.jurisdictions)
    cast = sum(j.ballots_cast or 0 for j in election.jurisdictions)
    if reg > 0 and cast > 0:
        return (cast / reg) * 100
    return None


def list_unique_offices(election: ElectionRecord) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for j in election.jurisdictions:
        for c in j.contests:
            if c.office not in seen:
                seen.add(c.office)
                ordered.append(c.office)
    return ordered


def office_breakdown_by_jurisdiction(
    election: ElectionRecord, office: str
) -> dict[str, Any]:
    """Votes per candidate by jurisdiction for charting one office."""
    series_keys: set[str] = set()
    rows: list[dict[str, Any]] = []
    for j in election.jurisdictions:
        votes_for_office: dict[str, int] = defaultdict(int)
        total_j = 0
        for c in j.contests:
            if c.office != office:
                continue
            for cand in c.candidates:
                key = f"{cand.name}|{cand.party}"
                votes_for_office[key] += cand.votes
                total_j += cand.votes
                series_keys.add(key)
        if total_j == 0:
            continue
        row: dict[str, Any] = {"jurisdiction": j.name, "total_votes": total_j}
        for k, v in votes_for_office.items():
            row[k] = v
        rows.append(row)
    totals: dict[str, int] = defaultdict(int)
    for r in rows:
        for k in series_keys:
            totals[k] += int(r.get(k, 0))
    sorted_keys = sorted(series_keys, key=lambda x: totals[x], reverse=True)
    labels = [k.split("|", 1)[0] for k in sorted_keys]
    return {
        "office": office,
        "candidate_keys": sorted_keys,
        "candidate_labels": labels,
        "rows": rows,
    }


def transform_election_to_insights(election: ElectionRecord) -> dict[str, Any]:
    offices = list_unique_offices(election)
    overall_turnout = compute_overall_turnout(election)

    summary_kpis: list[dict[str, Any]] = []
    if overall_turnout is not None:
        summary_kpis.append(
            {
                "id": "turnout",
                "label": "Overall turnout",
                "value": f"{overall_turnout:.1f}%",
                "detail": "Ballots cast ÷ registered voters, all jurisdictions",
            }
        )

    total_cast = sum(j.ballots_cast or 0 for j in election.jurisdictions)
    if total_cast > 0:
        summary_kpis.append(
            {
                "id": "ballots",
                "label": "Ballots counted",
                "value": f"{total_cast:,}",
                "detail": "Sum of reported ballots cast",
            }
        )

    jurisdictions_summary: list[dict[str, Any]] = []
    for j in election.jurisdictions:
        t = jurisdiction_turnout_pct(j)
        jurisdictions_summary.append(
            {
                "id": j.id or j.name,
                "name": j.name,
                "turnout_pct": round(t, 2) if t is not None else None,
                "registered": j.registered_voters,
                "ballots_cast": j.ballots_cast,
                "contest_count": len(j.contests),
            }
        )

    race_snapshots: list[dict[str, Any]] = []
    monitoring_alerts: list[dict[str, Any]] = []

    for office in offices:
        board = build_office_leaderboard(election, office)
        grand, _ = aggregate_office_across_jurisdictions(election, office)
        leader = board[0] if board else None
        runner = board[1] if len(board) > 1 else None
        margin_pct = None
        if leader and runner and grand > 0:
            margin_pct = ((leader["votes"] - runner["votes"]) / grand) * 100
        is_close = margin_pct is not None and margin_pct < CLOSE_RACE_THRESHOLD_PCT

        race_snapshots.append(
            {
                "office": office,
                "total_votes": grand,
                "leader": leader,
                "runner_up": runner,
                "margin_pct": round(margin_pct, 3) if margin_pct is not None else None,
                "is_close_race": is_close,
                "candidates": board,
            }
        )

        if is_close and leader and runner:
            monitoring_alerts.append(
                {
                    "severity": "warning",
                    "title": f"Close race: {office}",
                    "message": (
                        f"{leader['name']} leads {runner['name']} by "
                        f"{margin_pct:.2f} percentage points."
                    ),
                }
            )

    for row in jurisdictions_summary:
        t = row.get("turnout_pct")
        if t is None:
            continue
        if t < LOW_TURNOUT_THRESHOLD_PCT:
            monitoring_alerts.append(
                {
                    "severity": "info",
                    "title": f"Turnout watch: {row['name']}",
                    "message": (
                        f"Turnout is {t:.1f}%, below the {LOW_TURNOUT_THRESHOLD_PCT:.0f}% "
                        "monitoring threshold."
                    ),
                }
            )
        elif t > HIGH_TURNOUT_THRESHOLD_PCT:
            monitoring_alerts.append(
                {
                    "severity": "info",
                    "title": f"Strong participation: {row['name']}",
                    "message": f"Turnout is {t:.1f}%, above typical high-participation levels.",
                }
            )

    per_jurisdiction_contests: list[dict[str, Any]] = []
    for j in election.jurisdictions:
        contests_out: list[dict[str, Any]] = []
        for c in j.contests:
            r = rollup_contest(c)
            contests_out.append(
                {
                    "office": c.office,
                    "total_votes": r.total_votes,
                    "winner": r.winner.name if r.winner else None,
                    "winner_party": r.winner.party if r.winner else None,
                    "margin_pct": round(r.margin_pct, 3) if r.margin_pct is not None else None,
                    "is_close_race": r.is_close,
                }
            )
        per_jurisdiction_contests.append({"jurisdiction": j.name, "contests": contests_out})

    narrative_bullets: list[str] = []
    if overall_turnout is not None:
        narrative_bullets.append(
            f"Participation: about {overall_turnout:.1f}% of registered voters returned a ballot."
        )
    for snap in race_snapshots:
        if not snap.get("leader"):
            continue
        lead = snap["leader"]
        office = snap["office"]
        m = snap.get("margin_pct")
        if m is not None:
            narrative_bullets.append(
                f"{office}: {lead['name']} ({lead.get('party') or 'n/a'}) leads with "
                f"{lead.get('vote_share_pct', 0):.1f}% of votes; margin vs next place is {m:.2f} points."
            )
        else:
            narrative_bullets.append(
                f"{office}: {lead['name']} leads with {lead.get('vote_share_pct', 0):.1f}% of votes."
            )

    geographic_breakdowns = {
        o: office_breakdown_by_jurisdiction(election, o) for o in offices
    }

    return {
        "election_id": election.election_id,
        "title": election.title,
        "reported_at": election.reported_at.isoformat() if election.reported_at else None,
        "offices": offices,
        "summary_kpis": summary_kpis,
        "jurisdictions": jurisdictions_summary,
        "races": race_snapshots,
        "by_jurisdiction": per_jurisdiction_contests,
        "monitoring_alerts": monitoring_alerts,
        "narrative_bullets": narrative_bullets,
        "geographic_breakdowns": geographic_breakdowns,
        "thresholds": {
            "close_race_margin_pct": CLOSE_RACE_THRESHOLD_PCT,
            "low_turnout_pct": LOW_TURNOUT_THRESHOLD_PCT,
            "high_turnout_pct": HIGH_TURNOUT_THRESHOLD_PCT,
        },
    }
