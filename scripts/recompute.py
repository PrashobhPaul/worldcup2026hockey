"""
Hockey.AI — bring the published data back into agreement with itself.

A merge brings in a players.json built by the default branch's pipeline, which
runs the default branch's code. Everything derived from the match record then
has to be recomputed against the file that actually arrived: ids deduplicated,
tournament aggregates and positional ratings rebuilt, intros checked against
the official team list, the fingerprint restamped.

Four steps, always the same four, always in that order — the fingerprint last
because it describes whatever the others produced. Doing three of them leaves
the data self-inconsistent in a way CI catches and a reader would not.

    python3 scripts/recompute.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import update_data as ud                                    # noqa: E402


def main():
    fixtures = ud.load('fixtures.json')
    players = ud.load('players.json')

    changed = ud.dedupe_player_ids(players)
    changed |= ud.update_player_stats(fixtures, players)
    # The reconciliation stamp is a statement about one specific build of the
    # figures against one specific fetch of the FIH reports. Rebuilding the
    # figures makes it a verdict about nothing — the 29 Aug repair shipped a
    # clean players.json still carrying the corrupted build's 28 disagreements
    # — so a rebuild always drops it, and the pipeline re-stamps against
    # freshly fetched reports on its next run. The stats gate treats an absent
    # audit as fine and a present-but-unhappy one as a failure, which is
    # exactly the distinction being kept truthful here.
    if players.pop('official_figures_check', None) is not None:
        changed = True
        print('official-figures audit dropped — it described the previous build; '
              'CI re-stamps it against fresh FIH reports.')
    if changed:
        ud.save('players.json', players)
        print('players.json recomputed.')
    else:
        print('players.json already agrees with the match record.')

    subprocess.run([sys.executable, os.path.join(HERE, 'team_intro_review.py')], check=True)
    subprocess.run([sys.executable, os.path.join(HERE, 'data_fingerprint.py'), '--write'],
                   check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
