# Evaluation

The same fifty questions, answered three ways.

| | Called | Accuracy | Brier (on the pick) |
|---|---|---|---|
| Statistical model (published) | 37/50 | 74% | 0.222 |
| Language model (replay) | 31/50 | 62% | 0.232 |
| Actual results | 50/50 | — | — |

Accuracy counts a pick at 51% and one at 97% the same. The Brier score does not — lower is better, and it is the figure to read when comparing two forecasters.

**Brier (on the pick)** is the squared error of the confidence given to the outcome named, against whether it happened. It is deliberately not the Brier the app publishes on its calibration, which is the three-way score over home/draw/away: a language model returns one pick and one confidence, not a distribution, so the binary form is the only one both columns can be scored on. Two different measures, two different names.

## By stage

| Stage | Statistical model | Language model |
|---|---|---|
| Stage 1 | 21/24 | 19/24 |
| Stage 2 | 11/16 | 7/16 |
| Knockouts | 5/10 | 5/10 |

Language-model column: `claude-code` / `isolated session per match, no API key`, run 2026-08-30.

Each of the fifty prompts was answered in its own isolated session that was handed the SYSTEM instruction and that one prompt and nothing else — no repository, no web, no later match. No API key was used or committed. Anyone with a key of their own can regenerate this file from the same prompts by running scripts/llm_backtest.py.

An LLM is not deterministic — a second run may differ, and that spread is itself worth reporting. Re-run it and commit your own column:

```
python3 scripts/llm_backtest.py
python3 scripts/test_llm_backtest.py
python3 scripts/eval_table.py --write
```

## Every match

| # | Match | Result | Model | LLM |
|---|---|---|---|---|
| 1 | D1 | IND 3-1 WAL — HOME | HOME ✓ | HOME ✓ |
| 2 | B1 | GER 5-1 MAS — HOME | HOME ✓ | HOME ✓ |
| 3 | D2 | ENG 4-1 PAK — HOME | HOME ✓ | HOME ✓ |
| 4 | B2 | BEL 3-2 FRA — HOME | HOME ✓ | HOME ✓ |
| 5 | C1 | AUS 3-1 IRL — HOME | HOME ✓ | HOME ✓ |
| 6 | C2 | ESP 3-1 RSA — HOME | HOME ✓ | HOME ✓ |
| 7 | A2 | NED 5-1 NZL — HOME | HOME ✓ | HOME ✓ |
| 8 | A1 | ARG 3-0 JPN — HOME | HOME ✓ | HOME ✓ |
| 9 | D4 | PAK 3-3 WAL — DRAW | AWAY ✗ | HOME ✗ |
| 10 | B4 | FRA 3-3 MAS — DRAW | HOME ✗ | HOME ✗ |
| 11 | D3 | IND 2-4 ENG — AWAY | AWAY ✓ | AWAY ✓ |
| 12 | B3 | GER 1-0 BEL — HOME | HOME ✓ | AWAY ✗ |
| 13 | A4 | NZL 2-0 JPN — HOME | HOME ✓ | HOME ✓ |
| 14 | C3 | ESP 0-1 AUS — AWAY | AWAY ✓ | AWAY ✓ |
| 15 | C4 | IRL 4-1 RSA — HOME | HOME ✓ | HOME ✓ |
| 16 | A3 | ARG 1-3 NED — AWAY | HOME ✗ | AWAY ✓ |
| 17 | D5 | ENG 8-2 WAL — HOME | HOME ✓ | HOME ✓ |
| 18 | D6 | PAK 3-5 IND — AWAY | AWAY ✓ | AWAY ✓ |
| 19 | B6 | FRA 1-1 GER — DRAW | DRAW ✓ | AWAY ✗ |
| 20 | B5 | BEL 5-3 MAS — HOME | HOME ✓ | HOME ✓ |
| 21 | C5 | AUS 2-2 RSA — DRAW | DRAW ✓ | HOME ✗ |
| 22 | A6 | NZL 1-7 ARG — AWAY | AWAY ✓ | AWAY ✓ |
| 23 | C6 | IRL 1-3 ESP — AWAY | AWAY ✓ | AWAY ✓ |
| 24 | A5 | NED 4-1 JPN — HOME | HOME ✓ | HOME ✓ |
| 25 | S2H1 | FRA 1-3 RSA — AWAY | AWAY ✓ | HOME ✗ |
| 26 | S2H2 | IRL 7-4 MAS — HOME | HOME ✓ | HOME ✓ |
| 27 | S2F2 | GER 1-2 ESP — AWAY | DRAW ✗ | HOME ✗ |
| 28 | S2F1 | AUS 1-1 BEL — DRAW | DRAW ✓ | HOME ✗ |
| 29 | S2G1 | NZL 7-2 WAL — HOME | HOME ✓ | HOME ✓ |
| 30 | S2G2 | PAK 4-3 JPN — HOME | HOME ✓ | HOME ✓ |
| 31 | S2E1 | NED 3-1 IND — HOME | HOME ✓ | HOME ✓ |
| 32 | S2E2 | ENG 1-3 ARG — AWAY | AWAY ✓ | HOME ✗ |
| 33 | S2H3 | MAS 3-3 RSA — DRAW | DRAW ✓ | AWAY ✗ |
| 34 | S2H4 | FRA 2-1 IRL — HOME | HOME ✓ | AWAY ✗ |
| 35 | S2F3 | GER 4-2 AUS — HOME | HOME ✓ | AWAY ✗ |
| 36 | S2F4 | ESP 1-1 BEL — DRAW | DRAW ✓ | HOME ✗ |
| 37 | S2G3 | JPN 3-2 WAL — HOME | DRAW ✗ | HOME ✓ |
| 38 | S2G4 | NZL 4-2 PAK — HOME | AWAY ✗ | HOME ✓ |
| 39 | S2E3 | ARG 5-3 IND — HOME | AWAY ✗ | HOME ✓ |
| 40 | S2E4 | NED 2-2 ENG — DRAW | AWAY ✗ | HOME ✗ |
| 41 | POS13 | JPN 1-3 FRA — AWAY | AWAY ✓ | AWAY ✓ |
| 42 | POS15 | WAL 2-2 MAS — HOME | AWAY ✗ | AWAY ✗ |
| 43 | POS11 | PAK 4-4 RSA — HOME | AWAY ✗ | HOME ✓ |
| 44 | POS9 | NZL 6-3 IRL — HOME | HOME ✓ | HOME ✓ |
| 45 | POS5 | ENG 0-2 AUS — AWAY | HOME ✗ | HOME ✗ |
| 46 | SF1 | NED 3-4 ESP — AWAY | HOME ✗ | HOME ✗ |
| 47 | POS7 | IND 3-3 BEL — AWAY | AWAY ✓ | AWAY ✓ |
| 48 | SF2 | GER 2-1 ARG — HOME | HOME ✓ | AWAY ✗ |
| 49 | BRZ | NED 1-2 ARG — AWAY | HOME ✗ | HOME ✗ |
| 50 | GOLD | ESP 0-1 GER — AWAY | AWAY ✓ | AWAY ✓ |

Reproduce this table with `python3 scripts/eval_table.py --write`. Every figure is recomputed from `public/data/`; nothing here is stored.
