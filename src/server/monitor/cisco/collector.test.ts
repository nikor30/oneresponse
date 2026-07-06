import { describe, expect, it } from 'vitest';
import { normaliseEcho, normaliseJitter, decodeTargetAddress, type JitterValues } from './collector.js';
import {
  SENSE_OK_ALT,
  SENSE_OK_PRIMARY,
  RTT_MON_LATEST_JITTER_RTT_MIN,
  RTT_MON_LATEST_JITTER_LOSS_SD,
  RTT_MON_LATEST_JITTER_SENSE,
  RTT_MON_LATEST_JITTER_OW_SUM_SD,
  RTT_MON_LATEST_JITTER_MOS,
  RTT_MON_LATEST_JITTER_ICPIF,
} from './mibConstants.js';

// Convenience builder: all-null jitter values with overrides.
function jv(overrides: Partial<JitterValues>): JitterValues {
  return {
    numRtt: null, rttSum: null, rttMin: null, rttMax: null,
    numPosSd: null, sumPosSd: null, numNegSd: null, sumNegSd: null,
    numPosDs: null, sumPosDs: null, numNegDs: null, sumNegDs: null,
    lossSd: null, lossDs: null, oos: null, mia: null, late: null,
    sense: null,
    owSumSd: null, owMinSd: null, owMaxSd: null,
    owSumDs: null, owMinDs: null, owMaxDs: null, numOw: null,
    mos: null, icpif: null,
    ...overrides,
  };
}

describe('jitter OID layout (regression guard)', () => {
  // The canonical CISCO-RTTMON-MIB numbering — an earlier revision used a
  // shifted layout that read Sense where PacketLossSD lives. Pin the
  // corrected columns so nobody re-shifts them.
  it('uses the canonical rttMonLatestJitterOperTable columns', () => {
    expect(RTT_MON_LATEST_JITTER_RTT_MIN.endsWith('.5.2.1.4')).toBe(true);
    expect(RTT_MON_LATEST_JITTER_LOSS_SD.endsWith('.5.2.1.26')).toBe(true);
    expect(RTT_MON_LATEST_JITTER_SENSE.endsWith('.5.2.1.31')).toBe(true);
    expect(RTT_MON_LATEST_JITTER_OW_SUM_SD.endsWith('.5.2.1.33')).toBe(true);
    expect(RTT_MON_LATEST_JITTER_MOS.endsWith('.5.2.1.42')).toBe(true);
    expect(RTT_MON_LATEST_JITTER_ICPIF.endsWith('.5.2.1.43')).toBe(true);
  });
});

describe('normaliseEcho', () => {
  it('happy path — sense=ok, completion time → min=avg=max=rtt', () => {
    const r = normaliseEcho(42, SENSE_OK_PRIMARY);
    expect(r.latency_min).toBe(42);
    expect(r.latency_avg).toBe(42);
    expect(r.latency_max).toBe(42);
    expect(r.jitter).toBe(0);
    expect(r.loss_pct).toBe(0);
    expect(r.probe_count).toBe(1);
    expect(r.rtts).toEqual([42]);
  });

  it('accepts alternative success sense=1', () => {
    const r = normaliseEcho(42, SENSE_OK_ALT);
    expect(r.loss_pct).toBe(0);
    expect(r.latency_avg).toBe(42);
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
    const r = normaliseEcho(null, SENSE_OK_PRIMARY);
    expect(r.loss_pct).toBe(100);
    expect(r.latency_min).toBe(0);
  });
});

describe('normaliseJitter', () => {
  it('happy path with positive/negative SD+DS jitter samples', () => {
    // 10 RTTs, sum 250ms → avg 25; positives SD: 4 samples sum 12ms;
    // negatives SD: 2 samples sum 4ms; positives DS: 3 sum 9; negatives DS: 1 sum 1.
    // Total jitter samples 10, sum 26 → avg jitter 2.6ms.
    // SD jitter: 16/6 ≈ 2.667; DS jitter: 10/4 = 2.5. No loss.
    const r = normaliseJitter(jv({
      numRtt: 10, rttSum: 250, rttMin: 18, rttMax: 35,
      numPosSd: 4, sumPosSd: 12, numNegSd: 2, sumNegSd: 4,
      numPosDs: 3, sumPosDs: 9, numNegDs: 1, sumNegDs: 1,
      lossSd: 0, lossDs: 0, oos: 0, mia: 0, late: 0,
      sense: SENSE_OK_PRIMARY, mos: 410,
    }));
    expect(r.latency_min).toBe(18);
    expect(r.latency_avg).toBe(25);
    expect(r.latency_max).toBe(35);
    expect(r.jitter).toBe(2.6);
    expect(r.loss_pct).toBe(0);
    expect(r.probe_count).toBe(10);
    expect(r.mos).toBeCloseTo(4.10, 2);
    expect(r.ipsla?.jitter_sd).toBeCloseTo(16 / 6, 3);
    expect(r.ipsla?.jitter_ds).toBeCloseTo(2.5, 3);
  });

  it('computes loss% against numRtt+lost and keeps per-direction counts', () => {
    // 80 received, 10 lost SD, 5 lost DS, 4 MIA, 1 out-of-sequence
    // → 20 lost, 100 total → 20%
    const r = normaliseJitter(jv({
      numRtt: 80, rttSum: 80, rttMin: 1, rttMax: 1,
      lossSd: 10, lossDs: 5, mia: 4, oos: 1, late: 2,
      sense: SENSE_OK_PRIMARY, mos: 360,
    }));
    expect(r.loss_pct).toBe(20);
    expect(r.probe_count).toBe(80);
    expect(r.mos).toBeCloseTo(3.60, 2);
    expect(r.ipsla?.loss_sd).toBe(10);
    expect(r.ipsla?.loss_ds).toBe(5);
    expect(r.ipsla?.pkt_mia).toBe(4);
    expect(r.ipsla?.pkt_oos).toBe(1);
    expect(r.ipsla?.pkt_late).toBe(2);
  });

  it('computes one-way latency averages when NTP-synced OW data is present', () => {
    const r = normaliseJitter(jv({
      numRtt: 20, rttSum: 400, rttMin: 15, rttMax: 30,
      sense: SENSE_OK_PRIMARY,
      owSumSd: 240, owMinSd: 10, owMaxSd: 16,
      owSumDs: 160, owMinDs: 6, owMaxDs: 11,
      numOw: 20,
      icpif: 8,
    }));
    expect(r.ipsla?.ow_sd_avg).toBe(12);
    expect(r.ipsla?.ow_sd_min).toBe(10);
    expect(r.ipsla?.ow_sd_max).toBe(16);
    expect(r.ipsla?.ow_ds_avg).toBe(8);
    expect(r.ipsla?.icpif).toBe(8);
  });

  it('leaves one-way fields null when NTP is not synced (numOw=0/absent)', () => {
    const r = normaliseJitter(jv({
      numRtt: 20, rttSum: 400, rttMin: 15, rttMax: 30,
      sense: SENSE_OK_PRIMARY,
      owSumSd: 0, owMinSd: 0, owMaxSd: 0, numOw: 0,
    }));
    expect(r.ipsla?.ow_sd_avg).toBeNull();
    expect(r.ipsla?.ow_sd_min).toBeNull();
    expect(r.ipsla?.ow_ds_avg).toBeNull();
  });

  it('bad sense → fully lost regardless of other fields', () => {
    const r = normaliseJitter(jv({
      numRtt: 10, rttSum: 200, rttMin: 18, rttMax: 35,
      sense: 5, mos: 400, // sense 5 = timeout
    }));
    expect(r.loss_pct).toBe(100);
    expect(r.mos).toBeNull();
    expect(r.ipsla).toBeNull();
  });

  it('numRtt=0 (probe never ran) → down sample', () => {
    const r = normaliseJitter(jv({
      numRtt: 0, rttSum: 0, sense: SENSE_OK_PRIMARY, mos: 0,
    }));
    expect(r.loss_pct).toBe(100);
    expect(r.latency_avg).toBe(0);
  });

  it('no MOS reported → mos is null, not 0', () => {
    const r = normaliseJitter(jv({
      numRtt: 10, rttSum: 250, rttMin: 20, rttMax: 30,
      sense: SENSE_OK_PRIMARY, mos: null,
    }));
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
