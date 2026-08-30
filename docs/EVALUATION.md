# Evaluation

The same fifty questions, answered three ways.

| | Called | Accuracy | Brier (on the pick) |
|---|---|---|---|
| Statistical model (published) | 37/50 | 74% | 0.222 |
| Language model (replay) | not run | — | — |
| Actual results | 50/50 | — | — |

Accuracy counts a pick at 51% and one at 97% the same. The Brier score does not — lower is better, and it is the figure to read when comparing two forecasters.

**Brier (on the pick)** is the squared error of the confidence given to the outcome named, against whether it happened. It is deliberately not the Brier the app publishes on its calibration, which is the three-way score over home/draw/away: a language model returns one pick and one confidence, not a distribution, so the binary form is the only one both columns can be scored on. Two different measures, two different names.

## By stage

| Stage | Statistical model | Language model |
|---|---|---|
| Stage 1 | 21/24 | not run |
| Stage 2 | 11/16 | not run |
| Knockouts | 5/10 | not run |

No language-model run is committed. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (optionally `AI_MODEL`) and run:

```
python3 scripts/llm_backtest.py
python3 scripts/test_llm_backtest.py
python3 scripts/eval_table.py --write
```

The key is needed for that one run and nothing else; the committed result stands afterwards without it.

## Every match

| # | Match | Result | Model | LLM |
|---|---|---|---|---|
| 1 | D1 | IND 3-1 WAL — HOME | HOME ✓ | — |
| 2 | B1 | GER 5-1 MAS — HOME | HOME ✓ | — |
| 3 | D2 | ENG 4-1 PAK — HOME | HOME ✓ | — |
| 4 | B2 | BEL 3-2 FRA — HOME | HOME ✓ | — |
| 5 | C1 | AUS 3-1 IRL — HOME | HOME ✓ | — |
| 6 | C2 | ESP 3-1 RSA — HOME | HOME ✓ | — |
| 7 | A2 | NED 5-1 NZL — HOME | HOME ✓ | — |
| 8 | A1 | ARG 3-0 JPN — HOME | HOME ✓ | — |
| 9 | D4 | PAK 3-3 WAL — DRAW | AWAY ✗ | — |
| 10 | B4 | FRA 3-3 MAS — DRAW | HOME ✗ | — |
| 11 | D3 | IND 2-4 ENG — AWAY | AWAY ✓ | — |
| 12 | B3 | GER 1-0 BEL — HOME | HOME ✓ | — |
| 13 | A4 | NZL 2-0 JPN — HOME | HOME ✓ | — |
| 14 | C3 | ESP 0-1 AUS — AWAY | AWAY ✓ | — |
| 15 | C4 | IRL 4-1 RSA — HOME | HOME ✓ | — |
| 16 | A3 | ARG 1-3 NED — AWAY | HOME ✗ | — |
| 17 | D5 | ENG 8-2 WAL — HOME | HOME ✓ | — |
| 18 | D6 | PAK 3-5 IND — AWAY | AWAY ✓ | — |
| 19 | B6 | FRA 1-1 GER — DRAW | DRAW ✓ | — |
| 20 | B5 | BEL 5-3 MAS — HOME | HOME ✓ | — |
| 21 | C5 | AUS 2-2 RSA — DRAW | DRAW ✓ | — |
| 22 | A6 | NZL 1-7 ARG — AWAY | AWAY ✓ | — |
| 23 | C6 | IRL 1-3 ESP — AWAY | AWAY ✓ | — |
| 24 | A5 | NED 4-1 JPN — HOME | HOME ✓ | — |
| 25 | S2H1 | FRA 1-3 RSA — AWAY | AWAY ✓ | — |
| 26 | S2H2 | IRL 7-4 MAS — HOME | HOME ✓ | — |
| 27 | S2F2 | GER 1-2 ESP — AWAY | DRAW ✗ | — |
| 28 | S2F1 | AUS 1-1 BEL — DRAW | DRAW ✓ | — |
| 29 | S2G1 | NZL 7-2 WAL — HOME | HOME ✓ | — |
| 30 | S2G2 | PAK 4-3 JPN — HOME | HOME ✓ | — |
| 31 | S2E1 | NED 3-1 IND — HOME | HOME ✓ | — |
| 32 | S2E2 | ENG 1-3 ARG — AWAY | AWAY ✓ | — |
| 33 | S2H3 | MAS 3-3 RSA — DRAW | DRAW ✓ | — |
| 34 | S2H4 | FRA 2-1 IRL — HOME | HOME ✓ | — |
| 35 | S2F3 | GER 4-2 AUS — HOME | HOME ✓ | — |
| 36 | S2F4 | ESP 1-1 BEL — DRAW | DRAW ✓ | — |
| 37 | S2G3 | JPN 3-2 WAL — HOME | DRAW ✗ | — |
| 38 | S2G4 | NZL 4-2 PAK — HOME | AWAY ✗ | — |
| 39 | S2E3 | ARG 5-3 IND — HOME | AWAY ✗ | — |
| 40 | S2E4 | NED 2-2 ENG — DRAW | AWAY ✗ | — |
| 41 | POS13 | JPN 1-3 FRA — AWAY | AWAY ✓ | — |
| 42 | POS15 | WAL 2-2 MAS — HOME | AWAY ✗ | — |
| 43 | POS11 | PAK 4-4 RSA — HOME | AWAY ✗ | — |
| 44 | POS9 | NZL 6-3 IRL — HOME | HOME ✓ | — |
| 45 | POS5 | ENG 0-2 AUS — AWAY | HOME ✗ | — |
| 46 | SF1 | NED 3-4 ESP — AWAY | HOME ✗ | — |
| 47 | POS7 | IND 3-3 BEL — AWAY | AWAY ✓ | — |
| 48 | SF2 | GER 2-1 ARG — HOME | HOME ✓ | — |
| 49 | BRZ | NED 1-2 ARG — AWAY | HOME ✗ | — |
| 50 | GOLD | ESP 0-1 GER — AWAY | AWAY ✓ | — |

Reproduce this table with `python3 scripts/eval_table.py --write`. Every figure is recomputed from `public/data/`; nothing here is stored.
