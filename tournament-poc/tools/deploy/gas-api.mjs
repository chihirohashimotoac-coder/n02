// Apps Script API（REST）の最小限の呼び出し。本番反映（tools/deploy/deploy.mjs）から使う。
//
// 使う API（https://developers.google.com/apps-script/api/reference/rest）:
//   GET  /v1/projects/{scriptId}/content                       現在のコード（バックアップ）
//   PUT  /v1/projects/{scriptId}/content                       コードの置き換え（全ファイル。appsscript.json が必須）
//   POST /v1/projects/{scriptId}/versions                      版（バージョン）の作成
//   GET  /v1/projects/{scriptId}/deployments/{deploymentId}    既存のデプロイ（今の版番号）
//   PUT  /v1/projects/{scriptId}/deployments/{deploymentId}    既存のデプロイの版を差し替える（URL は変わらない）
// 新しいデプロイの作成（POST …/deployments）は使わない（Web アプリの URL が変わり、運営画面・閲覧ページが動かなくなるため）。
//
// 認証: clasp（@google/clasp 3.x）で `clasp login` したときの ~/.clasprc.json の内容（refresh token）から、
// その都度アクセストークンを取る。トークン・refresh token はログに出さない。

const API = 'https://script.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** ~/.clasprc.json の内容から { clientId, clientSecret, refreshToken } を取り出す（clasp 3.x と 2.x の形式） */
export function parseClasprc(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('TOURNAMENT_CLASPRC_JSON が JSON として読めません（~/.clasprc.json の内容をそのまま登録してください）。');
  }
  // clasp 3.x: { tokens: { default: { client_id, client_secret, refresh_token, … } } }
  const t3 = json && json.tokens && (json.tokens.default || Object.values(json.tokens)[0]);
  if (t3 && t3.refresh_token) return { clientId: t3.client_id, clientSecret: t3.client_secret, refreshToken: t3.refresh_token };
  // clasp 2.x: { token: { refresh_token, … }, oauth2ClientSettings: { clientId, clientSecret } }
  if (json && json.token && json.token.refresh_token && json.oauth2ClientSettings) {
    return { clientId: json.oauth2ClientSettings.clientId, clientSecret: json.oauth2ClientSettings.clientSecret, refreshToken: json.token.refresh_token };
  }
  throw new Error('TOURNAMENT_CLASPRC_JSON に refresh token が見つかりません（clasp login 後の ~/.clasprc.json を登録してください）。');
}

/** refresh token からアクセストークンを取る */
export async function accessToken(creds, fetchImpl = fetch) {
  const body = new URLSearchParams({ client_id: creds.clientId || '', client_secret: creds.clientSecret || '', refresh_token: creds.refreshToken, grant_type: 'refresh_token' });
  const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // 応答の本文（トークンを含みうる）は出さず、エラーの種類だけを出す
    throw new Error('Google のアクセストークンを取得できませんでした（' + res.status + ' ' + (json.error || '') + '）。clasp login をやり直して TOURNAMENT_CLASPRC_JSON を更新してください。');
  }
  return json.access_token;
}

export function createGasApi(token, fetchImpl = fetch) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(API + path, {
      method,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (e) {
      json = {};
    }
    if (!res.ok) {
      const msg = (json.error && (json.error.status + ' ' + json.error.message)) || String(res.status);
      const err = new Error(`Apps Script API ${method} ${path.replace(/\/projects\/[^/]+/, '/projects/…')}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return json;
  };
  return {
    getContent: (scriptId) => call('GET', `/projects/${encodeURIComponent(scriptId)}/content`),
    updateContent: (scriptId, files) => call('PUT', `/projects/${encodeURIComponent(scriptId)}/content`, { scriptId, files }),
    createVersion: (scriptId, description) => call('POST', `/projects/${encodeURIComponent(scriptId)}/versions`, { description }),
    getDeployment: (scriptId, deploymentId) => call('GET', `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`),
    updateDeployment: (scriptId, deploymentId, versionNumber, description) =>
      call('PUT', `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {
        deploymentConfig: { scriptId, versionNumber, manifestFileName: 'appsscript', description },
      }),
  };
}
