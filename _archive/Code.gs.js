/* ═══════════════════════════════════════════════════════════════
   ⛔ 폐기 — 참조용 보관본. 현행 시스템에서 사용하지 않습니다.
      Ver 1.0(2026-05-20)에 Supabase 직접 연동으로 전환하면서 폐기됐습니다.
      보관 이유: GAS 시절 NP 계산 원본(runNPCalculationAll)이 유일하게 남아 있음.
      실행·수정하지 마세요. Vercel 배포에서도 제외됩니다(.vercelignore).
   ═══════════════════════════════════════════════════════════════
   Golf League Management System — Code.gs
   구글 앱스 스크립트 백엔드 (v1.0)

   ● 이 파일을 구글 스프레드시트의 Apps Script 편집기에 붙여넣으세요.
   ● 시트 이름: tb_member, tb_Course, tb_Match, tb_Record
   ═══════════════════════════════════════════════════════════════ */

// ─── 설정 ──────────────────────────────────────────────────────
const SS = SpreadsheetApp.getActiveSpreadsheet();

// ─── 웹앱 진입점 (라우팅 추가) ──────────────────────────────────────────────
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'index';

  // API 요청 처리
  if (page === 'api') {
    const action = e.parameter.action || '';
    let result = {};
    
    try {
      switch (action) {
        case 'getAllData':
          result = getAllData();
          break;
        case 'runCalculation':
          result = runNPCalculationAll();
          break;
        default:
          result = { error: '알 수 없는 액션: ' + action };
      }
    } catch (err) {
      result = { error: err.message };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // URL 뒤에 ?page=admin 이 붙으면 관리자 화면, 아니면 사용자 화면 서빙
  const templateName = (page === 'admin') ? 'Admin' : 'Index';
  const pageTitle = (page === 'admin') ? '⚙️ 대회 관리자 시스템' : '⛳ 골프 리그 관리 시스템';

  return HtmlService
    .createHtmlOutputFromFile(templateName)
    .setTitle(pageTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

// ─── POST 요청 처리 (관리자 API용) ──────────────────────────────
function doPost(e) {
  let result = {};
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    const payload = body.payload ? JSON.stringify(body.payload) : '{}';
    
    switch (action) {
      case 'apiGetActiveMatches':
        result = apiGetActiveMatches();
        break;
      case 'apiCreateMatchAndPreInsert':
        result = apiCreateMatchAndPreInsert(payload);
        break;
      case 'apiUpdateMatchRoster':
        result = apiUpdateMatchRoster(payload);
        break;
      case 'apiSetCourseMappingOnly':
        result = apiSetCourseMappingOnly(payload);
        break;
      case 'apiDrawExcludeHolesAndCalculate':
        result = apiDrawExcludeHolesAndCalculate(payload);
        break;
      case 'apiSaveJsonScoresAndCalculate':
        result = apiSaveJsonScoresAndCalculate(payload);
        break;
      default:
        result = { error: '알 수 없는 액션: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── 전체 데이터 조회 (프론트엔드용) ──────────────────────────
function getAllData() {
  return {
    members: getMembers(),
    courses: getCourses(),
    matches: getMatches(),
    records: getRecords(),
    seasons: getSeasons() // 새로 추가된 시즌 데이터
  };
}

// ─── tb_member 읽기 ────────────────────────────────────────────
function getMembers() {
  const sh = SS.getSheetByName('tb_member');
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).filter(row => row[1]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    // 날짜 포맷 정리
    if (obj['생년월일'] instanceof Date) obj['생년월일'] = formatDate(obj['생년월일']);
    if (obj['가입일'] instanceof Date) obj['가입일'] = formatDate(obj['가입일']);
    // 전화번호를 텍스트로
    obj['전화번호'] = String(obj['전화번호']);
    return obj;
  });
}

// ─── tb_Course 읽기 ────────────────────────────────────────────
function getCourses() {
  const sh = SS.getSheetByName('tb_Course');
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).filter(row => row[0]).map(row => {
    const obj = { 구장명: row[0], 코스명: row[1], P: [] };
    for (let i = 2; i < 11; i++) {
      obj.P.push(Number(row[i]) || 4);
    }
    return obj;
  });
}

// ─── tb_Season 읽기 ────────────────────────────────────────────
function getSeasons() {
  const sh = SS.getSheetByName('tb_Season');
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  
  return data.slice(1).filter(row => row[0]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    obj['시작_대회번호'] = String(obj['시작_대회번호'] || '');
    obj['종료_대회번호'] = String(obj['종료_대회번호'] || '');
    return obj;
  });
}

// ─── tb_Match_Episodes 읽기 (시트명 수정 완료) ────────────────────────────────
function getMatches() {
  const sh = SS.getSheetByName('tb_Match_Episodes'); // 여기가 tb_Match로 되어있던 것을 수정!
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  
  return data.slice(1).filter(row => row[0]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    if (obj['날짜'] instanceof Date) obj['날짜'] = formatDate(obj['날짜']);
    obj['대회번호'] = String(obj['대회번호']);
    return obj;
  });
}

// ─── tb_Record 읽기 ────────────────────────────────────────────
function getRecords() {
  const sh = SS.getSheetByName('tb_Record');
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  
  return data.slice(1).filter(row => row[0]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    
    // scores 배열 구성 (H1~H18)
    const scores = [];
    for (let i = 1; i <= 18; i++) {
      scores.push(Number(obj['H' + i]) || 0);
    }
    obj.scores = scores;
    obj['전화번호'] = String(obj['전화번호']);
    obj['대회번호'] = String(obj['대회번호']);
    obj['합계'] = Number(obj['합계']) || 0;
    obj['NP_Handicap'] = Number(obj['NP_Handicap']) || 0;
    obj['Net_Score'] = Number(obj['Net_Score']) || 0;
    obj['Luck_Factor'] = Number(obj['Luck_Factor']) || 0;
    
    return obj;
  });
}

// ═══════════════════════════════════════════════════════════════
// 신페리오 자동 정산 엔진
// ═══════════════════════════════════════════════════════════════

/**
 * tb_Record의 모든 행에 대해 신페리오 정산을 실행합니다.
 * H1~H18이 입력된 행에 대해 합계, NP_Handicap, Net_Score, Luck_Factor를 자동 계산하여 시트에 기록합니다.
 */

function runNPCalculationAll() {
  const recordSh = SS.getSheetByName('tb_Record');
  if (!recordSh) return { error: 'tb_Record 시트를 찾을 수 없습니다.' };
  
  const courses = getCourses();
  const matches = getMatches(); // 이제 tb_Match_Episodes를 정상적으로 읽어옵니다.
  
  const data = recordSh.getDataRange().getValues();
  if (data.length < 2) return { error: '데이터가 없습니다.' };
  
  const headers = data[0];
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });
  
  const h1Col = colIdx['H1'];
  const sumCol = colIdx['합계'];
  const npCol = colIdx['NP_Handicap'];
  const netCol = colIdx['Net_Score'];
  const luckCol = colIdx['Luck_Factor'];
  let updatedCount = 0;
  
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row[colIdx['대회번호']]) continue;
    
    // H1 셀이 비어있으면 스코어 입력이 안 된 것으로 간주하고 패스
    if (row[h1Col] === '') continue; 
    
    const scores = [];
    for (let h = 0; h < 18; h++) {
      scores.push(Number(row[h1Col + h]) || 0);
    }
    
    const matchId = String(row[colIdx['대회번호']]);
    const venue = String(row[colIdx['구장명']]);
    const frontCourseName = String(row[colIdx['전반코스']]);
    const backCourseName = String(row[colIdx['후반코스']]);
    
    // 코스 파 정보 조회
    const frontCourse = courses.find(c => String(c['구장명']) === venue && String(c['코스명']) === frontCourseName);
    const backCourse = courses.find(c => String(c['구장명']) === venue && String(c['코스명']) === backCourseName);
    
    if (!frontCourse || !backCourse) continue;
    
    // 매치 제외홀 조회 (헤더가 '코스' 또는 '코스명'일 경우 모두 대응)
    const frontMatch = matches.find(m => String(m['대회번호']) === matchId && (String(m['코스']) === frontCourseName || String(m['코스명']) === frontCourseName));
    const backMatch = matches.find(m => String(m['대회번호']) === matchId && (String(m['코스']) === backCourseName || String(m['코스명']) === backCourseName));
    
    if (!frontMatch || !backMatch) continue;
    
    const frontExclude = String(frontMatch['제외홀']).split(',').map(Number);
    const backExclude = String(backMatch['제외홀']).split(',').map(Number);
    
    const pars = [...frontCourse.P, ...backCourse.P];
    let overParSelected = 0;
    let totalOverPar = 0;
    
    // 전반 9홀 계산
    for (let h = 0; h < 9; h++) {
      const over = Math.max(0, scores[h]); // 0미만(언더파)은 신페리오 오버파 합산 시 0으로 처리하는 골프 룰 적용
      totalOverPar += over;
      if (!frontExclude.includes(h + 1)) overParSelected += over;
    }
    
    // 후반 9홀 계산
    for (let h = 0; h < 9; h++) {
      const over = Math.max(0, scores[h + 9]);
      totalOverPar += over;
      if (!backExclude.includes(h + 1)) overParSelected += over;
    }
    
    // NP 핸디캡 = (12개홀 오버파 합 × 1.5) × 0.8, 소수점 첫째자리 반올림
    const npHandicap = Math.round(overParSelected * 1.5 * 0.8);
    const total = scores.reduce((a, b) => a + b, 0); // 오버파 총합 (합계 컬럼용)
    
    // 넷스코어 (기준타수 72 + 전체오버파 - 핸디캡)
    const totalPar = pars.reduce((a, b) => a + b, 0); 
    const grossScore = totalPar + total; 
    const netScore = grossScore - npHandicap;
    
    const expectedHdcp = totalOverPar * 0.8;
    const luckFactor = Math.round((npHandicap - expectedHdcp) * 10) / 10;
    
    const rowNum = r + 1;
    recordSh.getRange(rowNum, sumCol + 1).setValue(grossScore); // 그로스 스코어 기록
    recordSh.getRange(rowNum, npCol + 1).setValue(npHandicap);
    recordSh.getRange(rowNum, netCol + 1).setValue(netScore);
    recordSh.getRange(rowNum, luckCol + 1).setValue(luckFactor);
    
    updatedCount++;
  }
  
  SpreadsheetApp.flush();
  return { success: true, updatedRows: updatedCount, message: updatedCount + '건 정산 완료' };
}

/**
 * 스프레드시트 메뉴에 "신페리오 정산" 버튼 추가
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⛳ 골프리그 관리')
    .addItem('🔄 신페리오 전체 정산 실행', 'runNPCalculationAll')
    .addToUi();
}

// ─── 유틸리티 ──────────────────────────────────────────────────
function formatDate(d) {
  if (!(d instanceof Date)) return String(d);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}


// ═══════════════════════════════════════════════════════════════
// ⛳ [관리자 전용 고도화 API] 세션 관리, 조편성 수정, 부분 저장 지원
// ═══════════════════════════════════════════════════════════════

function apiGetActiveMatches() {
  try {
    const sh = SS.getSheetByName('tb_Match_Episodes');
    if (!sh) return [];
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    
    const matchMap = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const matchId = String(row[0]);
      if (String(row[6] || '').trim() === '완료') continue; 
      
      if (!matchMap[matchId]) {
        matchMap[matchId] = {
          matchId: matchId, matchName: row[1],
          date: row[2] instanceof Date ? formatDate(row[2]) : String(row[2]),
          venue: row[3]
        };
      }
    }
    return Object.values(matchMap);
  } catch (err) { return []; }
}

function apiCreateMatchAndPreInsert(payload) {
  try {
    const data = JSON.parse(payload);
    const recordSh = SS.getSheetByName('tb_Record');
    const epSh = SS.getSheetByName('tb_Match_Episodes');
    
    const epData = epSh.getDataRange().getValues();
    for(let i=1; i<epData.length; i++) {
      if(String(epData[i][0]) === String(data.matchId)) return { success: false, error: '해당 날짜로 이미 생성된 대회가 있습니다. 상단에서 대회를 불러와주세요.' };
    }

    let lastSeq = 0;
    const records = recordSh.getDataRange().getValues();
    if(records.length > 1) lastSeq = Number(records[records.length - 1][0]) || 0;

    const newRows = [];
    data.players.forEach((p, idx) => {
      newRows.push([
        lastSeq + idx + 1, data.matchId, data.venue, '', '', 
        p.phone, p.name, p.nickname, p.group, p.team, p.league,
        ...Array(18).fill(''), '', '', '', ''
      ]);
    });
    if(newRows.length > 0) recordSh.getRange(recordSh.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);

    const courses = getCourses().filter(c => c['구장명'] === data.venue);
    const newEpRows = [];
    courses.forEach(c => newEpRows.push([data.matchId, data.matchName, data.date, data.venue, c['코스명'], '', '진행중']));
    if(newEpRows.length > 0) epSh.getRange(epSh.getLastRow() + 1, 1, newEpRows.length, newEpRows[0].length).setValues(newEpRows);
    
    return { success: true, message: '대회가 성공적으로 생성되었습니다.' };
  } catch (err) { return { success: false, error: err.message }; }
}

// ★ 신규 추가: 기존 대회의 조편성 수정 (기존 데이터 삭제 후 재삽입)
function apiUpdateMatchRoster(payload) {
  try {
    const data = JSON.parse(payload);
    const recordSh = SS.getSheetByName('tb_Record');
    const recData = recordSh.getDataRange().getValues();
    
    // 역순으로 삭제해야 인덱스가 꼬이지 않음
    const rowsToDelete = [];
    for(let i = recData.length - 1; i >= 1; i--) {
      if(String(recData[i][1]) === String(data.matchId)) rowsToDelete.push(i + 1);
    }
    rowsToDelete.forEach(r => recordSh.deleteRow(r));
    
    let lastSeq = 0;
    const currentData = recordSh.getDataRange().getValues();
    if(currentData.length > 1) lastSeq = Number(currentData[currentData.length - 1][0]) || 0;

    const newRows = [];
    data.players.forEach((p, idx) => {
      newRows.push([
        lastSeq + idx + 1, data.matchId, data.venue, '', '', 
        p.phone, p.name, p.nickname, p.group, p.team, p.league,
        ...Array(18).fill(''), '', '', '', ''
      ]);
    });
    if(newRows.length > 0) recordSh.getRange(recordSh.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
    
    return { success: true, message: '조편성이 성공적으로 수정되었습니다.' };
  } catch (err) { return { success: false, error: err.message }; }
}

// ★ [변경] 2단계: 코스 매핑만 저장 (제외홀 추첨 없음)
function apiSetCourseMappingOnly(payload) {
  try {
    const data = JSON.parse(payload);
    const recordSh = SS.getSheetByName('tb_Record');
    const recData = recordSh.getDataRange().getValues();
    const colIdx = {};
    recData[0].forEach((h, i) => { colIdx[h] = i; });
    
    for(let r = 1; r < recData.length; r++) {
      if(String(recData[r][colIdx['대회번호']]) === String(data.matchId) && data.mappings[String(recData[r][colIdx['조번호']])]) {
        recordSh.getRange(r + 1, colIdx['전반코스'] + 1).setValue(data.mappings[String(recData[r][colIdx['조번호']])].front); 
        recordSh.getRange(r + 1, colIdx['후반코스'] + 1).setValue(data.mappings[String(recData[r][colIdx['조번호']])].back);  
      }
    }
    return { success: true, message: '코스 매핑이 저장되었습니다. (제외홀은 3단계에서 추첨합니다)' };
  } catch (err) { return { success: false, error: err.message }; }
}

// ★ [신규] 3단계: 제외홀 무작위 추첨 + 신페리오 정산 실행
function apiDrawExcludeHolesAndCalculate(payload) {
  try {
    const data = JSON.parse(payload);
    const epSh = SS.getSheetByName('tb_Match_Episodes');
    const allCourses = getCourses();
    
    const epData = epSh.getDataRange().getValues();
    let drawnCount = 0;
    
    for(let r = 1; r < epData.length; r++) {
      if(String(epData[r][0]) === String(data.matchId)) {
        const courseName = String(epData[r][4]);
        const courseMaster = allCourses.find(c => c['구장명'] === data.venue && c['코스명'] === courseName);
        if(courseMaster) {
          let p3=[], p4=[], p5=[];
          courseMaster.P.forEach((par, idx) => { 
            if(par===3) p3.push(idx+1); 
            else if(par===4) p4.push(idx+1); 
            else if(par===5) p5.push(idx+1); 
          });
          const excludeHoles = [
            p3[Math.floor(Math.random()*p3.length)]||'', 
            p4[Math.floor(Math.random()*p4.length)]||'', 
            p5[Math.floor(Math.random()*p5.length)]||''
          ].filter(Boolean).join(',');
          epSh.getRange(r + 1, 6).setValue(excludeHoles);
          drawnCount++;
        }
      }
    }
    
    // 추첨 완료 후 즉시 신페리오 정산 실행
    const calcResult = runNPCalculationAll();
    
    // 추첨된 제외홀 정보를 조회하여 반환 (관리자 확인용)
    const updatedEpData = epSh.getDataRange().getValues();
    const drawnHoles = [];
    for(let r = 1; r < updatedEpData.length; r++) {
      if(String(updatedEpData[r][0]) === String(data.matchId)) {
        drawnHoles.push({ 코스: updatedEpData[r][4], 제외홀: updatedEpData[r][5] });
      }
    }
    
    return { 
      success: true, 
      message: `🎲 ${drawnCount}개 코스 제외홀 추첨 완료!\n${calcResult.message}\n\n추첨 결과:\n` + 
               drawnHoles.map(h => `  ${h.코스}: [${h.제외홀}]홀 제외`).join('\n'),
      drawnHoles: drawnHoles
    };
  } catch (err) { return { success: false, error: err.message }; }
}

function apiSaveJsonScoresAndCalculate(payload) {
  try {
    const data = JSON.parse(payload);
    const recordSh = SS.getSheetByName('tb_Record');
    const recData = recordSh.getDataRange().getValues();
    const headers = recData[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });
    
    let updateCount = 0;
    for(let r = 1; r < recData.length; r++) {
      if(String(recData[r][colIdx['대회번호']]) === String(data.matchId)) {
        const matchedScore = data.jsonScores.find(s => s.name === String(recData[r][colIdx['성명']]));
        if(matchedScore && matchedScore.scores.length === 18) {
          recordSh.getRange(r + 1, colIdx['H1'] + 1, 1, 18).setValues([matchedScore.scores]); 
          updateCount++;
        }
      }
    }
    
    // ★ 변경: 임시저장 시에는 정산을 실행하지 않음 (제외홀 추첨 버튼에서만 정산)
    // 최종 마감일 때만 완료 처리
    if (data.isFinal) {
      // 마감 시에는 정산이 이미 되어있어야 하므로 한번 더 실행
      runNPCalculationAll();
      
      const epSh = SS.getSheetByName('tb_Match_Episodes');
      const epData = epSh.getDataRange().getValues();
      for(let i = 1; i < epData.length; i++) {
        if(String(epData[i][0]) === String(data.matchId)) epSh.getRange(i + 1, 7).setValue('완료');
      }
      return { success: true, message: '스코어 정산 및 대회 마감 처리가 완료되었습니다.' };
    }
    
    return { success: true, message: updateCount + '명의 스코어가 임시저장되었습니다. (정산은 제외홀 추첨 시 실행됩니다)' };
  } catch (err) { return { success: false, error: err.message }; }
}