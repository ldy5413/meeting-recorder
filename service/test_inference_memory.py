"""Optional real tensor test; API-only environments do not install CUDA/PyTorch."""

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("vibevoice")
from vibevoice.modular.modular_vibevoice_tokenizer import (  # noqa: E402 — optional dependency
    VibeVoiceTokenizerStreamingCache,
)
from service.adapter import compact_streaming_cache  # noqa: E402


def test_streaming_tail_does_not_retain_full_activation_storage():
    compact_streaming_cache(VibeVoiceTokenizerStreamingCache)
    activation = torch.arange(300000, dtype=torch.float32).reshape(1, 3, 100000)
    tail = activation[:, :, -4:]
    cache = VibeVoiceTokenizerStreamingCache()
    cache.set("layer", torch.tensor([0]), tail)
    stored = cache.cache[("layer", 0)]
    assert torch.equal(stored, tail[0])
    assert stored.untyped_storage().nbytes() == stored.numel() * stored.element_size()
    assert (
        stored.untyped_storage().nbytes() < activation.untyped_storage().nbytes() / 1000
    )
