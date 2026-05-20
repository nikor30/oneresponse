import { describe, expect, it } from 'vitest';
import { normaliseEcho, normaliseJitter, decodeTargetAddress } from './collector.js';
import { SENSE_OK } from './mibConstants.js';

describe('normaliseEcho', () => {
  it('happy path — sense=ok, completion time → min=avg=max=rtt', () => {
    const r = normaliseEcho(42, SENSE_OK);
    expect(r.latency_min).toBe(42);
    expect(r.latency_avg).toBe(42);
    expect(r.latency_max).toBe(42);
    expect(r.jitter).toBe(0);
    expect(r.loss_pct).toBe(0);
    expect(r.probe_count).toBe(1);
    expect(r.rtts).toEqual([42]);
  });

  it('non-ok sense → marks as fully lost', () => {
    // sense=5 (timeout) is the most common failure
    const r = normaliseEcho(100, 5);
    expect(r.loss_pct).toBe(100);
    expect(r.probe_count).toBe(0);
    expect(r.latency_avg).toBe(0);
  });

  it('null completion time → fully lost even if sense is ok', () => {
    // Belt-and-braces: don't lie about RTT if the OID came back empty
    const r = normaliseEcho(null, SENSE_OK);
    expect(r.loss_pct).toBe(100);
    expect(r.latency_min).toBe(0);
  });
});

describe('normaliseJitter', () => {
  it('happy path with positive/negative SD+DS jitter samples', () => {
    // 10 RTTs, sum 250ms → avg 25; positives SD: 4 samples sum 12ms (3ms avg);
    // negatives SD: 2 samples sum 4ms; positives DS: 3 sum 9; negatives DS: 1 sum 1.
    // Total jitter samples 10, sum 26 → avg jitter 2.6ms.
    // No loss.
    const r = normaliseJitter([
      10, 250, 18, 35,        // numRtt rttSum rttMin rttMax
       4,   12,                // numPosSd sumPosSd
       2,    4,                // numNegSd sumNegSd
       3,    9,                // numPosDs sumPosDs
       1,    1,                // numNegDs sumNegDs
       0,    0,                // lossSd lossDs
       0,    0,                // mia oos
       SENSE_OK, 410,          // sense, mos (4.10 reported as 410)
    ]);
    expect(r.latency_min).toBe(18);
    expect(r.latency_avg).toBe(25);
    expect(r.latency_max).toBe(35);
    expect(r.jitter).toBe(2.6);
    expect(r.loss_pct).toBe(0);
    expect(r.probe_count).toBe(10);
    expect(r.mos).toBeCloseTo(4.10, 2);
  });

  it('computes loss% against numRtt+lost', () => {
    // 80 received, 10 lost SD, 5 lost DS, 4 MIA, 1 out-of-sequence
    // → 20 lost, 100 total → 20%
    const r = normaliseJitter([
      80, 80, 1, 1,
       0, 0, 0, 0, 0, 0, 0, 0,
      10, 5,  4, 1,
       SENSE_OK, 360,
    ]);
    expect(r.loss_pct).toBe(20);
    expect(r.probe_count).toBe(80);
    expect(r.mos).toBeCloseTo(3.60, 2);
  });

  it('bad sense → fully lost regardless of other fields', () => {
    const r = normaliseJitter([
      10, 200, 18, 35,
       4, 12, 2, 4, 3, 9, 1, 1,
       0, 0, 0, 0,
       5, 400, // sense 5 = timeout
    ]);
    expect(r.loss_pct).toBe(100);
    expect(r.mos).toBeNull();
  });

  it('numRtt=0 (probe never ran) → down sample', () => {
    const r = normaliseJitter([
      0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0,
      SENSE_OK, 0,
    ]);
    expect(r.loss_pct).toBe(100);
    expect(r.latency_avg).toBe(0);
  });

  it('no MOS reported → mos is null, not 0', () => {
    const r = normaliseJitter([
      10, 250, 20, 30,
      4, 12, 2, 4, 3, 9, 1, 1,
      0, 0, 0, 0,
      SENSE_OK, null,
    ]);
    expect(r.mos).toBeNull();
  });
});

describe('decodeTargetAddress', () => {
  it('decodes a 4-byte hex IP', () => {
    // 0x08080808 = 8.8.8.8
    expect(decodeTargetAddress('08080808')).toBe('8.8.8.8');
  });
  it('passes through a printable host string', () => {
    expect(decodeTargetAddress('router1.example.com')).toBe('router1.example.com');
  });
  it('null in → null out', () => {
    expect(decodeTargetAddress(null)).toBeNull();
  });
});
