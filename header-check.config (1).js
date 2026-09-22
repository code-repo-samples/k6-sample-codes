module.exports = {
    timeout: 5000,
    expectGlobal: ['Cache-Control'],
    urls: [
        { name: 'Homepage', url: 'http://localhost:8000/page1', expect: ['ETag', 'Vary'] },
        { name: 'FAQ (flaky 503)', url: 'http://localhost:8000/page2', expect: [{ header: 'Content-Type', contains: 'text' }], expectStatus: [200, 503] },
        { name: 'ContactUs redirect', url: 'http://localhost:8000/page3', expect: ['Location'], expectStatus: [301, 302], followRedirects: false },
        { name: 'Wrong content-type check (should fail)', url: 'http://localhost:8000/page1', expect: [{ header: 'Cache-Control', contains: 'no-store' }] },
    ],
};
