/**
 * ============================================
 *  JSAPI 收银台（支付宝 JSAPI 支付）
 * ============================================
 *
 * 支付流程：
 *   1. 收银台输入金额 → 调用 /cashier/create 创建订单
 *   2. 支付宝 App 内：通过 AlipayJSBridge 唤起支付
 *   3. 普通浏览器：跳转支付宝收银台页面完成支付
 *   4. 异步通知更新订单状态
 *
 * 使用方式：
 *   1. npm install
 *   2. 填写下方 CONFIG 中的支付宝配置
 *   3. node index.js
 *   4. 打开 http://localhost:3001/cashier.html
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const AlipaySdk = require('alipay-sdk').default;

// PostgreSQL 支持（Railway 部署时通过 DATABASE_URL 自动启用）
let pgPool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  console.log('>>> [DB] PostgreSQL 已启用');
}

const app = express();
const PORT = process.env.PORT || 3001;

// 静态文件服务
app.use(express.static(__dirname));

// 根路径重定向到收银台
app.get('/', (req, res) => {
  res.redirect('/cashier.html');
});

// ======================== 【配置区 — 请填入你的支付宝信息】 ========================

const CONFIG = {
  alipay: {
    // 支付宝应用ID
    appId: '2021005100605188',

    // 应用私钥（PKCS#8 格式）
    privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCep6xxJp++YAN3q0BVGpzYv31Ml6AmXUk+QHSyMCYjoWCsb9LFYCxZ4jpLyAX2TlegmUz8ToWxZREH0xjB+Szx0LKeZh6CUBL5gMi8C5OZiMrlp/+05WgeekCdYi8zdRP0gmD0/0UlagMQfkIMa3QpH6GTnYqXC8Zj1wryIOcsvX4g4EkcL5qefFAi/zl8e+fW/Yn9U0l+kDUU08pud8nfpntybYeesKSAJyaNfcnBCbcB+QC0fWTw21lCCWWd/948Tq3uGSr/VeSGL2HLicjC75yXrscEud9XKpcZq4LRxIY39yFPSAMiiK58D4D02tFzegPhP1gTlODBK0D6kyWLAgMBAAECggEAVrb2fXHK5da8jm+/XcSJ7b3b0j0df1qFacz4+1ttvRO7LwR/gvmpxAbuLfVJrPHs2w5vEYgpcmf3AvvSEFMMya5zsjfGfRsfA9fr3zvElKo7m4JTNKAeZGoVXvAHNGzNV1rbe4z6UhS7UAxyNS+V8dQkD/aPhTceW/txNB3fvIeIWavxGEJN8MNlvDu27inWflfWl7SllIA71yrGx6Fzy1fTrKTu3K9PUxv86M/DzhKY5g32/454P5RMzyExPlX0FMfhs0bCP63tXTCUjxfptfsqEqoJDC5wrmLFbAyJuqtEKGMpHwtt6TEsx8dPfUeMJVfF3gdGdyRCgKCOO7tGgQKBgQDdjTfAa49Cv2WUFGr79JHmclPJ2fbRfl/+PHy5vzsTtftu9OO8XjSbJ9PQqWJ7TEKoJKyGz5LDNU8ByWjBLgd2ucV7cZoyigVI4IiyxcJdBzfCEM9CtZhC7rnPJaJm7gBD/sT+2FQ7IjgMgRM/Y5AOxuvUOY6g9HdJ+lJ6m7SOMQKBgQC3UuCS842+6DLYwuXdAamJRIr0isRnPYYd69FnvpZAWTYwywF22bKGI+a0DVp67Mx/PJ3/9UlfKqKF0L+DmAbo0dZsLoGeRrdX9V4PKg2RinSzk+h+zfLV+iAx0h3vulYesRifuANiFTC3EjKbIKoldzZBy48txT73n9w9+mcUewKBgQCNtakmc+YDfKb9a33uwMWd0BzV7IvZ/epqlMf2i2G/PtSfaRZNwzgE0hnCysVKNkIgiKyt4hFuuSda7jgJ8GYnw7WUOtq1XuD4d14YczPaCybYA6Z+deb5UPcaj2jsS2lyFIBuvXJLDJ0rKlhkYEuhmAz6BwK64wN2Fx4wfG2l0QKBgQCr7u2yxPvm1W2CwF/HRFzV4dQU/+SuExSrEVVHYIcYeNMLNgn8hrYZeqhPq8p1SYuNtbNVsJ4MxDbDHAHSEI5CYzMgKQnmANrJgtWhkUZCfsFu/sRp0Qv0RW9WaoMrJ+7HQD8g5Ps/TTJwMIAH373T/5eCY8C4I6snoOV1t1hf6wKBgG6xRf4xbfR1ybELVLsShhj0n75EQ20ya9pXMEpTBcmCglLqYkiSNeoc4ia5Zrdh5vLcwUTFmqoB4hy7OLwjAeHcVR7BkI//mogQJ+Yt09bUYwlUrkrvKxfU4C/VB4wg5Ca6GONieUQIQ5/oi/DfT82ZHB4nn9/vuCDAibuqkxAv
-----END PRIVATE KEY-----`,

    // 支付宝公钥
    alipayPublicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAubDn2gdgvtZLrV6bogJgoW+04xKBPfmqXcoqmBEOVzgdfH1vAF5cTWx92dN5rXhTci7mHfQiS7loNNKhOElXl3zzSWSkO8qi0KfVXSiinIAmaLAFjBpRJa+UVArTWZ6hbXa1DEU3kHHvaN9xXXDg5zb04coibz+vx+HAsfacHWu1tU3aCGTI4GYqH/mwvqu2AZczbCH4wulHlKHfeab55PO2r7Uv3pAxCMZHhqmndArP2KlDSrwFPdq81kZGP05Xg4lKOrGxSGt5zqjo25PLMpFCKfE3y9LfCZrCNnecJ/ARfST3asUa3gz9NBJoP+y4U0Mzbc9A3ovWcE08qcwAXQIDAQAB
-----END PUBLIC KEY-----`,

    // 支付宝网关
    gateway: 'https://openapi.alipay.com/gateway.do',
  },

  // 商户名称
  merchantName: '',

  // 支付结果通知地址（支付宝异步回调）
  notifyUrl: '',

  // 支付完成跳转地址（用户支付后跳回）
  returnUrl: '',
};

// ======================== 【创建支付宝客户端】 ========================

function getAlipaySdk() {
  if (!CONFIG.alipay.appId || !CONFIG.alipay.privateKey) {
    throw new Error('支付宝配置未填写，请在 CONFIG 中填入 appId、privateKey、alipayPublicKey');
  }
  if (!alipaySdk) {
    alipaySdk = new AlipaySdk({
      appId: CONFIG.alipay.appId,
      privateKey: CONFIG.alipay.privateKey,
      alipayPublicKey: CONFIG.alipay.alipayPublicKey,
      gateway: CONFIG.alipay.gateway,
      keyType: 'PKCS8',
    });
  }
  return alipaySdk;
}

let alipaySdk = null;

// ======================== 【订单存储】 ========================

const ORDERS_FILE = path.join(__dirname, 'orders.json');
let adminOrders = [];

// 从数据库/文件加载持久化订单
async function loadOrders() {
  if (pgPool) {
    try {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS app_data (
          key VARCHAR(64) PRIMARY KEY,
          value JSONB
        )
      `);
      const result = await pgPool.query("SELECT value FROM app_data WHERE key = 'orders'");
      if (result.rows.length > 0) {
        adminOrders = result.rows[0].value;
        console.log(`>>> [DB] 已加载 ${adminOrders.length} 条历史订单`);
      } else {
        adminOrders = [];
        console.log('>>> [DB] 暂无历史订单，新数据库');
      }
    } catch (e) {
      console.error('>>> [DB] 加载失败:', e.message);
      adminOrders = [];
    }
  } else {
    try {
      if (fs.existsSync(ORDERS_FILE)) {
        adminOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
        console.log(`>>> [文件] 已加载 ${adminOrders.length} 条历史订单`);
      } else {
        adminOrders = [];
        console.log('>>> [文件] 暂无历史订单');
      }
    } catch (e) {
      console.error('>>> [文件] 加载失败:', e.message);
      adminOrders = [];
    }
  }
}

// 保存订单
async function saveOrders() {
  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO app_data (key, value) VALUES ('orders', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = $1::jsonb
      `, [JSON.stringify(adminOrders)]);
    } catch (e) {
      console.error('>>> [DB] 保存失败:', e.message);
    }
  } else {
    try {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify(adminOrders, null, 2), 'utf-8');
    } catch (e) {
      console.error('>>> [文件] 保存失败:', e.message);
    }
  }
}

// ======================== 【JSAPI 支付核心 — 创建交易】 ========================

/**
 * POST /cashier/create — 创建 JSAPI 交易订单
 * Body: { amount: string, subject: string, body?: string }
 *
 * 返回 trade_no，前端可用：
 *   - 支付宝 App 内：AlipayJSBridge.call('tradePay', { tradeNO: trade_no })
 *   - 普通浏览器：跳转 /cashier/page-pay/:outTradeNo
 */
app.post('/cashier/create', express.json(), async (req, res) => {
  const amount = String(req.body.amount || '').trim();
  const subject = String(req.body.subject || '收款').trim();
  const body = String(req.body.body || subject).trim();
  const buyerId = String(req.body.buyer_id || '').trim();
  const authCode = String(req.body.auth_code || '').trim();

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ code: 'ERROR', message: '请输入有效金额' });
  }

  const outTradeNo = `JSAPI_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 记录订单
  adminOrders.push({
    outTradeNo,
    tradeNo: '',
    amount: parseFloat(amount).toFixed(2),
    subject,
    status: 'created',
    createdAt: new Date().toISOString(),
    paidAt: null,
  });
  await saveOrders();

  // 获取 buyer_id（优先用传入的，否则用 auth_code 换）
  let resolvedBuyerId = buyerId;
  if (!resolvedBuyerId && authCode) {
    try {
      console.log(`>>> [OAuth] 用 authCode 换取 user_id: ${authCode}`);
      const oauthResult = await getAlipaySdk().exec('alipay.system.oauth.token', {
        grantType: 'authorization_code',
        code: authCode,
      });
      const oauthResp = oauthResult.alipay_system_oauth_token_response || oauthResult.alipaySystemOauthTokenResponse || oauthResult;
      resolvedBuyerId = oauthResp.userId || oauthResp.user_id;
      console.log(`>>> [OAuth] 换取成功: user_id=${resolvedBuyerId}, code=${oauthResp.code}, msg=${oauthResp.msg}`);
    } catch (err) {
      console.error('>>> [OAuth] 换取 user_id 失败:', err.message);
      return res.status(500).json({ code: 'OAUTH_ERROR', message: '授权信息换取失败: ' + err.message });
    }
  }

  if (!resolvedBuyerId) {
    return res.status(400).json({
      code: 'NO_BUYER_ID',
      message: '缺少 buyer_id（请在支付宝 App 中打开并授权）',
    });
  }

  // 调用 alipay.trade.create
  try {
    console.log(`>>> [JSAPI] 创建交易: ${outTradeNo}, 金额: ¥${amount}, buyer: ${resolvedBuyerId}`);

    const result = await getAlipaySdk().exec('alipay.trade.create', {
      bizContent: {
        out_trade_no: outTradeNo,
        total_amount: parseFloat(amount).toFixed(2),
        subject,
        body,
        buyer_id: resolvedBuyerId,
      },
    });

    const resp = result.alipay_trade_create_response || result;
    const tradeNo = resp.tradeNo || resp.trade_no;

    console.log(`>>> [JSAPI] create 响应: code=${resp.code}, msg=${resp.msg}, trade_no=${tradeNo}`);

    if (resp.code === '10000' && tradeNo) {
      const order = adminOrders.find(o => o.outTradeNo === outTradeNo);
      if (order) order.tradeNo = tradeNo;
      await saveOrders();

      return res.json({
        code: 'OK',
        out_trade_no: outTradeNo,
        trade_no: tradeNo,
        amount,
        subject,
        message: '交易已创建，请完成支付',
      });
    } else {
      const errDetail = JSON.stringify({
        code: resp.code,
        sub_code: resp.subCode || resp.sub_code,
        sub_msg: resp.subMsg || resp.sub_msg,
        msg: resp.msg,
      });
      console.error(`>>> [JSAPI] 创建交易失败: ${errDetail}`);
      return res.status(500).json({
        code: 'ALIPAY_ERROR',
        message: '支付宝接口错误',
        detail: errDetail,
        alipay_code: resp.code,
        alipay_sub_code: resp.subCode || resp.sub_code,
        alipay_sub_msg: resp.subMsg || resp.sub_msg,
        alipay_msg: resp.msg,
      });
    }
  } catch (err) {
    console.error(`>>> [JSAPI] 异常:`, err.message);
    return res.status(500).json({ code: 'ERROR', message: '支付服务异常: ' + err.message });
  }
});

/**
 * GET /cashier/check — 查询订单支付状态
 * Query: out_trade_no
 */
app.get('/cashier/check', async (req, res) => {
  const outTradeNo = (req.query.out_trade_no || '').trim();
  if (!outTradeNo) {
    return res.status(400).json({ code: 'ERROR', message: '缺少 out_trade_no' });
  }

  try {
    const result = await getAlipaySdk().exec('alipay.trade.query', {
      bizContent: { out_trade_no: outTradeNo }
    });
    const resp = result.alipay_trade_query_response || result;
    const tradeStatus = resp.tradeStatus || resp.trade_status;
    const tradeNo = resp.tradeNo || resp.trade_no;

    if (resp.code === '10000') {
      if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
        // 更新订单状态
        const order = adminOrders.find(o => o.outTradeNo === outTradeNo);
        if (order && order.status !== 'paid') {
          order.status = 'paid';
          order.paidAt = new Date().toISOString();
          order.tradeNo = tradeNo;
          await saveOrders();
        }

        return res.json({
          code: 'OK',
          status: 'paid',
          trade_no: tradeNo,
          amount: resp.totalAmount || resp.total_amount,
        });
      }
      // 更新为支付中
      const order = adminOrders.find(o => o.outTradeNo === outTradeNo);
      if (order && order.status === 'created') {
        order.status = 'paying';
        await saveOrders();
      }
      return res.json({ code: 'OK', status: 'waiting', trade_status: tradeStatus });
    } else if (resp.code === '40004') {
      return res.json({ code: 'OK', status: 'waiting', message: '订单尚未支付' });
    } else {
      return res.json({ code: 'ERROR', message: resp.sub_msg || resp.msg, alipay_code: resp.code });
    }
  } catch (err) {
    return res.json({ code: 'ERROR', message: err.message });
  }
});

/**
 * POST /cashier/notify — 支付宝异步通知接收
 */
app.post('/cashier/notify', express.urlencoded({ extended: false }), async (req, res) => {
  console.log(`>>> [通知] 收到支付宝异步通知:`, JSON.stringify(req.body));

  const outTradeNo = req.body.out_trade_no;
  const tradeStatus = req.body.trade_status;
  const tradeNo = req.body.trade_no;

  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
    const order = adminOrders.find(o => o.outTradeNo === outTradeNo);
    if (order && order.status !== 'paid') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.tradeNo = tradeNo;
      await saveOrders();
      console.log(`>>> [通知] 支付成功: ${outTradeNo}, 交易号: ${tradeNo}`);
    }
  }

  res.send('success');
});

// ======================== 【管理后台 API】 ========================

/**
 * GET /api/orders — 获取所有订单
 */
app.get('/api/orders', (req, res) => {
  const list = [...adminOrders].reverse();
  res.json({ code: 'OK', data: list, total: list.length });
});

/**
 * POST /api/orders — 更新订单状态
 */
app.post('/api/orders', express.json(), async (req, res) => {
  const { outTradeNo, status } = req.body;
  const order = adminOrders.find(o => o.outTradeNo === outTradeNo);
  if (order) {
    order.status = status;
    if (status === 'paid') {
      order.paidAt = new Date().toISOString();
    }
    await saveOrders();
  }
  res.json({ code: 'OK' });
});

// ======================== 【退款 API】 ========================

app.post('/api/refund', express.json(), async (req, res) => {
  const { outTradeNo, refundAmount } = req.body;

  if (!outTradeNo) {
    return res.status(400).json({ code: 'ERROR', message: '缺少订单号' });
  }

  const order = adminOrders.find(o => o.outTradeNo === outTradeNo);
  if (!order) {
    return res.status(404).json({ code: 'ERROR', message: '订单不存在' });
  }

  if (order.status !== 'paid') {
    return res.status(400).json({ code: 'ERROR', message: '仅已支付的订单可以退款' });
  }

  if (order.refund) {
    return res.status(400).json({ code: 'ERROR', message: '该订单已退款，不能重复退款' });
  }

  const amount = refundAmount ? parseFloat(refundAmount).toFixed(2) : order.amount;
  const amountNum = parseFloat(amount);
  const orderAmountNum = parseFloat(order.amount);

  if (amountNum <= 0 || amountNum > orderAmountNum) {
    return res.status(400).json({ code: 'ERROR', message: `退款金额无效，应在 0.01 ~ ${order.amount} 之间` });
  }

  const outRequestNo = `RF_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`>>> [退款] 发起退款: ${outTradeNo}, 金额: ¥${amount}`);

    const result = await getAlipaySdk().exec('alipay.trade.refund', {
      bizContent: {
        out_trade_no: outTradeNo,
        refund_amount: amount,
        out_request_no: outRequestNo,
      }
    });

    const resp = result.alipay_trade_refund_response || result;
    console.log(`>>> [退款] 响应: code=${resp.code}, msg=${resp.msg}`);

    if (resp.code === '10000') {
      const refundTradeNo = resp.tradeNo || resp.trade_no;

      order.refund = {
        refundNo: refundTradeNo || '',
        refundAmount: amount,
        refundedAt: new Date().toISOString(),
        outRequestNo,
      };

      if (amountNum >= orderAmountNum) {
        order.status = 'refunded';
      } else {
        order.status = 'partial_refund';
      }

      await saveOrders();
      console.log(`>>> [退款] 退款成功: ${outTradeNo}, 退款号: ${refundTradeNo}`);

      return res.json({
        code: 'OK',
        message: '退款成功',
        refund_no: refundTradeNo,
        refund_amount: amount,
        out_request_no: outRequestNo,
      });
    } else {
      const errMsg = resp.subMsg || resp.sub_msg || resp.msg || '退款失败';
      return res.status(500).json({
        code: 'ALIPAY_ERROR',
        message: errMsg,
        alipay_code: resp.code,
      });
    }
  } catch (err) {
    console.error(`>>> [退款] 异常:`, err.message);
    res.status(500).json({ code: 'ERROR', message: '退款服务异常: ' + err.message });
  }
});

// ======================== 【安全设置】 ========================

let securityConfig = {
  passwordHash: null,
  skipPassword: false,
  merchantName: '',
  merchantContact: '',
  merchantPhone: '',
};

async function loadSecurity() {
  if (pgPool) {
    try {
      const result = await pgPool.query("SELECT value FROM app_data WHERE key = 'security'");
      if (result.rows.length > 0) {
        securityConfig = result.rows[0].value;
        console.log(`>>> [安全] 已加载, 密码:${!!securityConfig.passwordHash}, 免密:${securityConfig.skipPassword}`);
      }
    } catch (e) { console.error('>>> [安全] 加载失败:', e.message); }
  } else {
    try {
      const secFile = path.join(__dirname, 'security.json');
      if (fs.existsSync(secFile)) {
        securityConfig = JSON.parse(fs.readFileSync(secFile, 'utf-8'));
      }
    } catch (e) { console.error('>>> [安全] 文件加载失败:', e.message); }
  }
  if (!securityConfig.merchantName && CONFIG.merchantName) {
    securityConfig.merchantName = CONFIG.merchantName;
  }
  if (!securityConfig.merchantContact && CONFIG.merchantName) {
    securityConfig.merchantContact = CONFIG.merchantName;
  }
}

async function saveSecurity() {
  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO app_data (key, value) VALUES ('security', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = $1::jsonb
      `, [JSON.stringify(securityConfig)]);
    } catch (e) { console.error('>>> [安全] 保存失败:', e.message); }
  } else {
    try {
      fs.writeFileSync(path.join(__dirname, 'security.json'), JSON.stringify(securityConfig, null, 2), 'utf-8');
    } catch (e) { console.error('>>> [安全] 文件保存失败:', e.message); }
  }
}

function hashPassword(pwd) {
  return crypto.createHash('sha256').update('jsapi_pay_' + pwd + '_sec_2024').digest('hex');
}

app.get('/api/security', (req, res) => {
  res.json({
    code: 'OK',
    data: {
      hasPassword: !!securityConfig.passwordHash,
      skipPassword: securityConfig.skipPassword,
      merchantName: securityConfig.merchantName || CONFIG.merchantName || '',
      merchantContact: securityConfig.merchantContact || '',
      merchantPhone: securityConfig.merchantPhone || '',
    },
  });
});

app.post('/api/security/merchant-name', express.json(), async (req, res) => {
  securityConfig.merchantName = String(req.body.name || '').trim();
  await saveSecurity();
  res.json({ code: 'OK', merchantName: securityConfig.merchantName });
});

app.post('/api/security/merchant-info', express.json(), async (req, res) => {
  securityConfig.merchantContact = String(req.body.merchantContact || '').trim();
  securityConfig.merchantPhone = String(req.body.merchantPhone || '').trim();
  await saveSecurity();
  res.json({ code: 'OK', merchantContact: securityConfig.merchantContact, merchantPhone: securityConfig.merchantPhone });
});

app.post('/api/security/password', express.json(), async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ code: 'ERROR', message: '新密码长度不能少于4位' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ code: 'ERROR', message: '两次输入的密码不一致' });
  }
  if (securityConfig.passwordHash) {
    if (!oldPassword) return res.status(400).json({ code: 'ERROR', message: '请输入原密码' });
    if (hashPassword(oldPassword) !== securityConfig.passwordHash) {
      return res.status(400).json({ code: 'ERROR', message: '原密码错误' });
    }
  }
  securityConfig.passwordHash = hashPassword(newPassword);
  await saveSecurity();
  res.json({ code: 'OK', message: oldPassword ? '密码已修改' : '安全密码已设置' });
});

app.post('/api/security/verify', express.json(), (req, res) => {
  const { password } = req.body;
  if (!securityConfig.passwordHash) {
    return res.json({ code: 'OK', verified: true, message: '未设置安全密码' });
  }
  if (!password) return res.status(400).json({ code: 'ERROR', message: '请输入安全密码' });
  if (hashPassword(password) === securityConfig.passwordHash) {
    return res.json({ code: 'OK', verified: true, message: '验证通过' });
  }
  return res.status(400).json({ code: 'ERROR', verified: false, message: '密码错误' });
});

app.post('/api/security/skip', express.json(), async (req, res) => {
  const { password, enable } = req.body;
  if (!securityConfig.passwordHash) {
    return res.status(400).json({ code: 'ERROR', message: '请先设置二级安全密码' });
  }
  if (!password || hashPassword(password) !== securityConfig.passwordHash) {
    return res.status(400).json({ code: 'ERROR', message: '安全密码错误' });
  }
  securityConfig.skipPassword = !!enable;
  await saveSecurity();
  res.json({ code: 'OK', skipPassword: securityConfig.skipPassword, message: `免密退款已${securityConfig.skipPassword ? '开启' : '关闭'}` });
});

app.post('/api/security/reset-by-paypwd', express.json(), async (req, res) => {
  const { payPassword, newPassword, confirmPassword } = req.body;
  if (!payPassword || payPassword.length < 6) {
    return res.status(400).json({ code: 'ERROR', message: '请输入有效的支付宝支付密码' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ code: 'ERROR', message: '新密码长度不能少于4位' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ code: 'ERROR', message: '两次输入的新密码不一致' });
  }
  securityConfig.passwordHash = hashPassword(newPassword);
  await saveSecurity();
  res.json({ code: 'OK', message: '安全密码已重置' });
});

// ======================== 【限额设置】 ========================

const LIMITS_FILE = path.join(__dirname, 'limits.json');
let limitsConfig = { minAmount: null, maxAmount: null, dayCount: null, dayAmount: null, monthCount: null, monthAmount: null };

function loadLimits() {
  try { limitsConfig = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8')); } catch(e) {}
}

app.get('/api/limits', (req, res) => {
  res.json({ code: 'OK', success: true, config: limitsConfig });
});

app.post('/api/limits', express.json(), async (req, res) => {
  const body = req.body;
  limitsConfig = {
    minAmount: body.minAmount !== '' ? parseFloat(body.minAmount) : null,
    maxAmount: body.maxAmount !== '' ? parseFloat(body.maxAmount) : null,
    dayCount: body.dayCount !== '' ? parseInt(body.dayCount) : null,
    dayAmount: body.dayAmount !== '' ? parseFloat(body.dayAmount) : null,
    monthCount: body.monthCount !== '' ? parseInt(body.monthCount) : null,
    monthAmount: body.monthAmount !== '' ? parseFloat(body.monthAmount) : null
  };
  fs.writeFileSync(LIMITS_FILE, JSON.stringify(limitsConfig, null, 2), 'utf8');
  console.log('>>> [限额] 已更新限额配置:', JSON.stringify(limitsConfig));
  res.json({ code: 'OK', success: true });
});

// ======================== 【启动】 ========================

Promise.all([loadOrders(), loadSecurity(), loadLimits()]).then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  JSAPI 收银台（支付宝 JSAPI 支付）已启动');
    console.log(`  地址: http://localhost:${PORT}`);
    console.log('========================================');
    console.log('');
    console.log('  收银台：');
    console.log(`  http://localhost:${PORT}/cashier.html`);
    console.log('');
    console.log('  管理后台：');
    console.log(`  http://localhost:${PORT}/admin.html`);
    console.log('');
    console.log('  支付方式：支付宝 JSAPI 支付');
    console.log('  - 支付宝 App 内：JSAPI 原生唤起支付');
    console.log('  - 普通浏览器：跳转支付宝收银台');
    console.log('');
  });
}).catch(err => {
  console.error('>>> 启动失败:', err.message);
  process.exit(1);
});
