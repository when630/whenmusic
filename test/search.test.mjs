import test from 'node:test'
import assert from 'node:assert/strict'
import { likePattern, matches, parseQuery, toChoseong } from '../main/search.mjs'
import { normalize } from '../main/text.mjs'

test('완성형 한글을 초성으로 바꾸고 나머지는 그대로 둔다', () => {
  assert.equal(toChoseong('힙합'), 'ㅎㅎ')
  assert.equal(toChoseong('감성 힙합/R&B'), 'ㄱㅅ ㅎㅎ/R&B')
  assert.equal(toChoseong(''), '')
  assert.equal(toChoseong(null), '')
})

test('초성 변환은 길이를 바꾸지 않는다 — 인덱스가 원문과 맞아야 한다', () => {
  const src = '우연히 듣고 반해버려서'
  assert.equal(toChoseong(src).length, src.length)
})

test('전부 초성 자모면 초성 검색이다 (SRCH-02)', () => {
  assert.deepEqual(parseQuery('ㅎㅎ'), { terms: ['ㅎㅎ'], choseong: true })
  assert.deepEqual(parseQuery('감성 힙합'), { terms: ['감성', '힙합'], choseong: false })
  // 하나라도 섞이면 일반 검색이다
  assert.equal(parseQuery('ㅎㅎ 감성').choseong, false)
  assert.deepEqual(parseQuery('   ').terms, [])
})

test('LIKE 특수문자를 이스케이프한다', () => {
  assert.equal(likePattern('100%'), '%100\\%%')
  assert.equal(likePattern('a_b'), '%a\\_b%')
  assert.equal(likePattern('c\\d'), '%c\\\\d%')
})

test('제목과 채널 어느 쪽에 걸려도 찾는다 (SRCH-04)', () => {
  const row = { title: '[Playlist] 감성 힙합', channel: 'CherryMix' }

  assert.equal(matches(row, '힙합'), true)
  assert.equal(matches(row, 'cherry'), true) // 대소문자를 가리지 않는다
  assert.equal(matches(row, '재즈'), false)
})

test('여러 단어는 전부 걸려야 한다', () => {
  const row = { title: '감성 힙합 모음', channel: 'CherryMix' }

  assert.equal(matches(row, '감성 모음'), true)
  assert.equal(matches(row, '감성 재즈'), false)
})

test('초성 검색은 초성 컬럼을 본다', () => {
  const row = {
    title: '감성 힙합',
    channel: 'CherryMix',
    title_cho: toChoseong('감성 힙합'),
    channel_cho: toChoseong('CherryMix'),
  }

  assert.equal(matches(row, 'ㅎㅎ'), true)
  assert.equal(matches(row, 'ㄱㅅ'), true)
  assert.equal(matches(row, 'ㅈㅈ'), false)
})

test('빈 질의는 전부 통과시킨다', () => {
  assert.equal(matches({ title: '무엇이든' }, ''), true)
  assert.equal(matches({ title: '무엇이든' }, '   '), true)
})

test('유니코드 볼드로 쓰인 제목도 검색에 걸린다 (SRCH-03 · D-13)', () => {
  // 저장할 때 NFKC로 펴 두기 때문에 가능한 일이다
  const raw = '[𝐏𝐥𝐚𝐲𝐥𝐢𝐬𝐭] 감성 힙합'
  const row = { title: normalize(raw), channel: 'CherryMix' }

  assert.equal(matches(row, 'playlist'), true)
  assert.equal(matches({ title: raw, channel: '' }, 'playlist'), false) // 펴지 않으면 못 찾는다
})
