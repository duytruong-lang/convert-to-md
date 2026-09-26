// app/api/settings/test/route.ts
// POST /api/settings/test — verify API key hợp lệ với provider

import { getSetting } from '@/lib/settings';

export async function POST() {
  try {
    const provider = await getSetting('ai_provider');
    const envKey = provider === '9router' ? process.env.NINE_ROUTER_API_KEY : process.env.GEMINI_API_KEY;
    const apiKey = (await getSetting('ai_api_key')) || envKey;
    const model = await getSetting('ai_model');

    if (!apiKey) {
      return Response.json(
        { success: false, message: 'Chưa nhập API key. Vui lòng nhập và lưu trước.' },
        { status: 400 }
      );
    }

    if (provider === 'gemini') {
      // Test Gemini bằng cách gọi generateContent với prompt ngắn
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const targetModel = model || 'gemini-2.0-flash-lite';
      const geminiModel = genAI.getGenerativeModel({ model: targetModel });

      await geminiModel.generateContent('Hello');
      return Response.json({ success: true, message: `Kết nối ${provider} (${targetModel}) thành công!` });
    }

    if (provider === '9router') {
      const endpoint = (await getSetting('ai_endpoint')) || 'https://9router.congdongnguoidien.com/v1';
      const targetModel = model || 'fast-and-cheap-stack';
      const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
      const modelsUrl = cleanEndpoint.endsWith('/chat/completions')
        ? cleanEndpoint.replace(/\/chat\/completions$/, '/models')
        : `${cleanEndpoint}/models`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        // Ưu tiên GET /models để verify API key và endpoint tức thì (< 1s)
        const res = await fetch(modelsUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          return Response.json({
            success: true,
            message: `Kết nối 9router (${targetModel}) thành công!`,
          });
        }

        if (res.status === 401 || res.status === 403) {
          const txt = await res.text();
          let errMsg = txt;
          try {
            const errJson = JSON.parse(txt);
            errMsg = errJson.error?.message || errJson.message || txt;
          } catch {}
          return Response.json(
            { success: false, message: `Kết nối 9router thất bại [${res.status}]: ${errMsg.slice(0, 300)}` },
            { status: 400 }
          );
        }

        if (res.status !== 404 && res.status !== 405) {
          const txt = await res.text();
          return Response.json(
            { success: false, message: `Kết nối 9router thất bại [${res.status}]: ${txt.slice(0, 300)}` },
            { status: 400 }
          );
        }

        // Nếu endpoint không hỗ trợ /models (404/405), fallback sang POST /chat/completions
        const chatUrl = cleanEndpoint.endsWith('/chat/completions')
          ? cleanEndpoint
          : `${cleanEndpoint}/chat/completions`;
        const chatController = new AbortController();
        const chatTimeout = setTimeout(() => chatController.abort(), 25000);

        const chatRes = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
          }),
          signal: chatController.signal,
        });
        clearTimeout(chatTimeout);

        if (!chatRes.ok) {
          const txt = await chatRes.text();
          let errMsg = txt;
          try {
            const errJson = JSON.parse(txt);
            errMsg = errJson.error?.message || errJson.message || txt;
          } catch {}
          return Response.json(
            { success: false, message: `Kết nối 9router thất bại [${chatRes.status}]: ${errMsg.slice(0, 300)}` },
            { status: 400 }
          );
        }

        return Response.json({
          success: true,
          message: `Kết nối 9router (${targetModel}) thành công!`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json(
          { success: false, message: `Kết nối 9router thất bại: ${msg}` },
          { status: 400 }
        );
      }
    }

    if (provider === 'openai') {
      const targetModel = model || 'gpt-4o-mini';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const txt = await res.text();
          let errMsg = txt;
          try {
            const errJson = JSON.parse(txt);
            errMsg = errJson.error?.message || errJson.message || txt;
          } catch {}
          return Response.json(
            { success: false, message: `Kết nối OpenAI thất bại [${res.status}]: ${errMsg.slice(0, 300)}` },
            { status: 400 }
          );
        }

        return Response.json({
          success: true,
          message: `Kết nối OpenAI (${targetModel}) thành công!`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json(
          { success: false, message: `Kết nối OpenAI thất bại: ${msg}` },
          { status: 400 }
        );
      }
    }

    if (provider === 'anthropic') {
      const targetModel = model || 'claude-3-5-haiku-20241022';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: targetModel,
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const txt = await res.text();
          let errMsg = txt;
          try {
            const errJson = JSON.parse(txt);
            errMsg = errJson.error?.message || errJson.message || txt;
          } catch {}
          return Response.json(
            { success: false, message: `Kết nối Anthropic thất bại [${res.status}]: ${errMsg.slice(0, 300)}` },
            { status: 400 }
          );
        }

        return Response.json({
          success: true,
          message: `Kết nối Anthropic (${targetModel}) thành công!`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json(
          { success: false, message: `Kết nối Anthropic thất bại: ${msg}` },
          { status: 400 }
        );
      }
    }

    return Response.json(
      { success: false, message: `Provider "${provider}" chưa được hỗ trợ kiểm tra.` },
      { status: 400 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json(
      { success: false, message: `Kết nối thất bại: ${msg}` },
      { status: 400 }
    );
  }
}
