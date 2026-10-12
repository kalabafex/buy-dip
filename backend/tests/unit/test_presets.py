from dipbuyer.presets import PRESETS


def test_presets_are_valid_and_unique() -> None:
    assert len({p.symbol for p in PRESETS}) == len(PRESETS)
    for p in PRESETS:
        assert sum(t.amount_usd for t in p.tiers) <= p.max_position_usd
        assert max(t.amount_usd for t in p.tiers) <= 500  # fits the default daily cap
