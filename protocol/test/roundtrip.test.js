import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.js';

test('contribution token signs and verifies against payload hash', async () => {
  const k = await P.newPairKeys();
  const finding = { kind: 'bug', defect: 'off by one in pager', severity: 'low' };
  const tok = await P.signContribution({ privateJwk: k.privateJwk, pairId: 'pair-1', mandateId: 'm1', kind: 'finding', payload: finding });
  const c = await P.verifyContribution({ token: tok, publicJwk: k.publicJwk, payload: finding });
  assert.equal(c.sub, 'pair-1');
  await assert.rejects(P.verifyContribution({ token: tok, publicJwk: k.publicJwk, payload: { ...finding, severity: 'high' } }), /hash mismatch/);
});

test('mandates narrow, never widen', async () => {
  const net = await P.newPairKeys();
  const parentTok = await P.issueMandate({ issuerPrivateJwk: net.privateJwk, issuerId: 'network', holderPairId: 'principal-1', role: 'principal', scopePaths: ['src/'] });
  const parent = await P.verifyMandate({ token: parentTok, issuerPublicJwk: net.publicJwk });
  await P.issueMandate({ issuerPrivateJwk: net.privateJwk, issuerId: 'principal-1', holderPairId: 'b1', role: 'builder', scopePaths: ['src/pager/'], parent });
  await assert.rejects(P.issueMandate({ issuerPrivateJwk: net.privateJwk, issuerId: 'principal-1', holderPairId: 'b1', role: 'builder', scopePaths: ['lib/'], parent }), /widens scope/);
  await assert.rejects(P.issueMandate({ issuerPrivateJwk: net.privateJwk, issuerId: 'principal-1', holderPairId: 'b1', role: 'principal', scopePaths: ['src/'], parent: { ...parent, role: 'judge' } }), /widens role/);
  assert.equal(P.pathInScope('src/pager/x.js', ['src/pager/']), true);
  assert.equal(P.pathInScope('src/pagerx.js', ['src/pager']), false);
});

test('nonce round trip: mandate -> commit trailer + reasoning tag -> challenge-verified', async () => {
  const net = await P.newPairKeys();
  const nonce = P.newNonce();                                   // handed to the agent with the mandate
  const tok = await P.issueMandate({ issuerPrivateJwk: net.privateJwk, issuerId: 'network', holderPairId: 'b1', role: 'builder', scopePaths: ['src/'], nonce });
  const claims = await P.verifyMandate({ token: tok, issuerPublicJwk: net.publicJwk });
  assert.ok(claims.nonce_hash && !tok.includes(nonce));          // server never sees the nonce in the token

  const sha = 'a'.repeat(40);
  const msg = `fix pager\n\n${P.TRAILER}: ${nonce}\n`;
  const note = `${P.reasoningTag(nonce, sha)}\nI changed the loop bound because...`;
  assert.deepEqual(P.verifySubmission({ mandateClaims: claims, commitMessage: msg, commitSha: sha, reasoningNote: note }),
    { trailer_ok: true, nonce_ok: true, label: 'challenge-verified' });

  // wrong nonce, missing trailer, stale tag (different commit) all fail
  assert.equal(P.verifySubmission({ mandateClaims: claims, commitMessage: `fix\n\n${P.TRAILER}: ${P.newNonce()}`, commitSha: sha, reasoningNote: note }).label, 'unverified');
  assert.equal(P.verifySubmission({ mandateClaims: claims, commitMessage: 'fix', commitSha: sha, reasoningNote: note }).trailer_ok, false);
  assert.equal(P.verifySubmission({ mandateClaims: claims, commitMessage: msg, commitSha: 'b'.repeat(40), reasoningNote: note }).nonce_ok, false);
});
