#!/usr/bin/env node
// usage: node bin/tag.js <nonce> <head_sha>   → first line of the PR reasoning note
import { reasoningTag } from '../src/index.js';
const [nonce, sha] = process.argv.slice(2); if (!nonce || !sha) { console.error('usage: tag.js <nonce> <head_sha>'); process.exit(1); }
console.log(reasoningTag(nonce, sha));
