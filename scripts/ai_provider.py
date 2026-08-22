#!/usr/bin/env python3
"""Provider-agnostic AI completion for the Hockey.AI pipeline.

The pipeline is AI-first with a deterministic fallback: every job that can
be written by a language model (match briefs, pick rationales) asks this
module first, and composes the same content from the statistical engine
only when no provider is configured. Fork the repository, add ONE secret,
and the AI tier switches on:

    ANTHROPIC_API_KEY   -> Anthropic (default model: claude-sonnet-5)
    OPENAI_API_KEY      -> OpenAI    (default model: gpt-4o)

Optional overrides:

    AI_MODEL            -> exact model id for whichever provider is keyed

`complete()` returns the model's text, or None when no key is configured —
callers treat None as "use the deterministic engine instead". Both
providers are called over plain HTTPS with the standard library, so the
pipeline needs no SDK dependencies.
"""
import json
import os
import urllib.request

ANTHROPIC_DEFAULT = 'claude-sonnet-5'
OPENAI_DEFAULT = 'gpt-4o'


def provider():
    """('anthropic'|'openai'|None, api_key, model) from the environment."""
    key = os.environ.get('ANTHROPIC_API_KEY')
    if key:
        return 'anthropic', key, os.environ.get('AI_MODEL', ANTHROPIC_DEFAULT)
    key = os.environ.get('OPENAI_API_KEY')
    if key:
        return 'openai', key, os.environ.get('AI_MODEL', OPENAI_DEFAULT)
    return None, None, None


def complete(system, prompt, max_tokens=600, timeout=60):
    """One completion from the configured provider, or None without a key."""
    name, key, model = provider()
    if not name:
        return None
    if name == 'anthropic':
        body = json.dumps({
            'model': model,
            'max_tokens': max_tokens,
            'system': system,
            'messages': [{'role': 'user', 'content': prompt}],
        }).encode()
        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages', data=body,
            headers={'Content-Type': 'application/json',
                     'x-api-key': key,
                     'anthropic-version': '2023-06-01'})
        resp = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
        return ''.join(b.get('text', '') for b in resp.get('content', []))
    body = json.dumps({
        'model': model,
        'max_tokens': max_tokens,
        'messages': [{'role': 'system', 'content': system},
                     {'role': 'user', 'content': prompt}],
    }).encode()
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions', data=body,
        headers={'Content-Type': 'application/json',
                 'Authorization': f'Bearer {key}'})
    resp = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    return (resp.get('choices') or [{}])[0].get('message', {}).get('content', '')
