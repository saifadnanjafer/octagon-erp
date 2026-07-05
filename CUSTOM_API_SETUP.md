# Setting Up Your Custom API Key

Your custom API key has been added to the system. Here's how to use it:

## 1. **Environment Configuration** ✅ 
Your `.env` file has been created with your credentials:
```
CUSTOM_API_KEY=sk-REDACTED   # real key lives ONLY in .env (security hardening 2026-07-05)
CUSTOM_API_ENDPOINT=https://api.contactboxtools.me/v1
CUSTOM_API_PROVIDER=contactbox
CUSTOM_API_MODEL=gpt-4
```

## 2. **Install dotenv Package** (if not already installed)
Run this in your terminal:
```bash
npm install dotenv
```

## 3. **Server-Side Usage** (Node.js - server.js)
The server now loads environment variables automatically. Your API key is ready to use:
```javascript
// In server.js, the API key is available as:
const apiKey = process.env.CUSTOM_API_KEY;
const endpoint = process.env.CUSTOM_API_ENDPOINT;
```

## 4. **Client-Side Usage** (Browser - app.js)
Use the custom API integration module for AI features:
```javascript
// Call your custom API
CustomApiModule.callApi([
  { role: 'user', content: 'Hello, analyze this data...' }
], {
  temperature: 0.7,
  maxTokens: 2048,
  system: 'You are a helpful business analyst.'
}).then(response => {
  if (response.success) {
    console.log('Response:', response.content);
  } else {
    console.error('Error:', response.error);
  }
});

// Validate the connection
CustomApiModule.validate().then(result => {
  console.log(result.message);
});
```

## 5. **Example: Integrate into Existing AI Features**
To use your custom API in the calculator verification feature:

```javascript
async function verifyCalculatorWithCustomAPI() {
  const result = window.lastCalcResult;
  if (!result) return;
  
  const response = await CustomApiModule.callApi([
    { 
      role: 'user', 
      content: `Verify this salary calculation: ${JSON.stringify(result)}` 
    }
  ]);
  
  if (response.success) {
    showToast(response.content, 'success');
  } else {
    showToast(response.error, 'error');
  }
}
```

## 6. **Security Notes** ⚠️
- **Never commit `.env` file to version control**
- Add `.env` to your `.gitignore`:
  ```
  .env
  .env.local
  *.key
  *.pem
  ```
- Rotate your API key regularly in production
- Keep your endpoint URL secure

## 7. **API Request Format**
Your endpoint is OpenAI-compatible, so you can:
- Use the standard OpenAI library with custom base URL
- Send standard chat completion requests
- Get responses in OpenAI format

Example curl request:
```bash
curl -X POST https://api.contactboxtools.me/v1/chat/completions \
  -H "Authorization: Bearer sk-REDACTED" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

## 8. **Troubleshooting**
If the API doesn't work:
1. Check the `.env` file is in the root directory
2. Verify the API key is correct (starts with `sk-`)
3. Test connectivity: `CustomApiModule.validate()`
4. Check network tab in DevTools for request errors
5. Verify the endpoint URL is accessible

---

**Your API is now ready to use!** 🚀
