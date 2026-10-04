"""Keep historical bulk generators from replacing later source-reviewed work."""
import json


def require_uncurated(target, review_field):
    if not target.exists():
        return
    review = json.loads(target.read_text()).get(review_field, {})
    if isinstance(review, dict) and review.get('correctionReview'):
        raise SystemExit(
            f'{target.name} contains source-reviewed corrections. '
            'The historical bulk survey cannot replace it. '
            'Use the targeted correction controls or the map editor; '
            'generate a separate candidate when revisiting the survey.'
        )
