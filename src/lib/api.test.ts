import assert from 'node:assert/strict';
import test from 'node:test';
import { getCharacter, getCharacterReviews, listCharacters } from './api.js';
import type { Character, CharacterReviewsPage } from '../types/index.js';

const sampleCharacter: Character = {
  id: '2f460055-7595-4640-9cb6-c442c4c869b0',
  slug: 'alan-watts',
  name: 'Alan Watts',
  description: 'British and American writer and speaker.',
  tags: ['Philosophy', 'Buddhism'],
  adult: false,
  featured: true,
  modelId: 'venice-uncensored-1-2',
  author: 'k3x9q',
  createdAt: '2024-12-20T21:28:08.934Z',
  updatedAt: '2025-02-09T03:23:53.708Z',
  webEnabled: true,
  shareUrl: 'https://venice.ai/c/alan-watts',
  photoUrl: null,
  stats: {
    averageRating: 4.7,
    imports: 112,
    ratingCount: 24,
    ratingSum: 113,
    userRating: null,
  },
};

const sampleReviews: CharacterReviewsPage = {
  object: 'list',
  data: [{
    id: '1e38fb78-043f-4ce2-b3bc-966089c25467',
    characterId: sampleCharacter.id,
    createdAt: '2025-02-09T03:23:53.708Z',
    isOwner: false,
    locale: 'en',
    message: 'Thoughtful and practical.',
    rating: 5,
    userAvatarUrl: null,
    username: 'product_user_42',
  }],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  summary: { averageRating: 4.7, totalReviews: 1 },
};

test('character API helpers send documented requests and surface errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const requests: Array<{ url: string; method?: string }> = [];

  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method });

    const parsed = new URL(url);

    if (parsed.pathname.endsWith('/characters/missing')) {
      return new Response(JSON.stringify({ error: { message: 'Character not found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (parsed.pathname.endsWith('/characters/alan-watts/reviews')) {
      return jsonResponse(sampleReviews);
    }

    if (parsed.pathname.endsWith('/characters/alan-watts')) {
      return jsonResponse({ object: 'character', data: sampleCharacter });
    }

    if (parsed.pathname.endsWith('/characters')) {
      return jsonResponse({ object: 'list', data: [sampleCharacter] });
    }

    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;

  try {
    const listed = await listCharacters({
      search: 'philosophy',
      limit: 200,
      offset: 10,
      showSpinner: false,
    });
    assert.equal(listed[0].slug, 'alan-watts');

    const character = await getCharacter('alan-watts', { showSpinner: false });
    assert.equal(character.name, 'Alan Watts');
    assert.equal(character.modelId, 'venice-uncensored-1-2');

    const reviews = await getCharacterReviews('alan-watts', {
      page: 1,
      pageSize: 20,
      showSpinner: false,
    });
    assert.equal(reviews.data[0].rating, 5);
    assert.equal(reviews.summary.totalReviews, 1);

    await assert.rejects(
      () => getCharacter('missing', { showSpinner: false }),
      /Character not found/
    );

    const listUrl = new URL(requests[0].url);
    assert.equal(listUrl.searchParams.get('search'), 'philosophy');
    assert.equal(listUrl.searchParams.get('limit'), '100');
    assert.equal(listUrl.searchParams.get('offset'), '10');
    assert.match(requests[0].url, /\/characters\?/);

    assert.match(requests[1].url, /\/characters\/alan-watts$/);
    assert.match(requests[2].url, /\/characters\/alan-watts\/reviews\?/);
    const reviewsUrl = new URL(requests[2].url);
    assert.equal(reviewsUrl.searchParams.get('page'), '1');
    assert.equal(reviewsUrl.searchParams.get('pageSize'), '20');

    const defaults = await listCharacters({ showSpinner: false });
    assert.equal(defaults[0].slug, 'alan-watts');
    const defaultUrl = new URL(requests[4].url);
    assert.equal(defaultUrl.searchParams.get('limit'), '50');
    assert.equal(defaultUrl.searchParams.get('offset'), '0');
    assert.equal(defaultUrl.searchParams.has('search'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
