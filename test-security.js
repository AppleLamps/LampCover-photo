// Security test script to validate our fixes
const fs = require('fs');
const path = require('path');

// Test 1: Timestamp validation
console.log('Testing timestamp validation...');

function testTimestampValidation(input) {
    const sanitizedTimestamp = input.replace(/[^\d.]/g, '');
    
    if (!/^\d+(\.\d{1,6})?$/.test(sanitizedTimestamp)) {
        return { valid: false, reason: 'Invalid timestamp format' };
    }

    const ts = Number.parseFloat(sanitizedTimestamp);
    
    if (!Number.isFinite(ts) || ts < 0 || ts > 86400 || ts !== ts) {
        return { valid: false, reason: 'Invalid timestamp range' };
    }

    if (ts.toString() !== sanitizedTimestamp && ts.toFixed(6).replace(/\.?0+$/, '') !== sanitizedTimestamp) {
        return { valid: false, reason: 'Timestamp validation failed' };
    }

    return { valid: true, value: ts };
}

// Test cases for timestamp validation
const timestampTests = [
    { input: '10.5', expected: true },
    { input: '0', expected: true },
    { input: '86400', expected: true },
    { input: '86401', expected: false }, // Over limit
    { input: '-1', expected: false },    // Negative
    { input: '10;echo attack', expected: false }, // Command injection attempt
    { input: '10.5.5', expected: false }, // Multiple decimals
    { input: '10.1234567', expected: false }, // Too many decimal places
    { input: 'abc', expected: false }, // Non-numeric
    { input: '10 || rm -rf /', expected: false }, // Command injection
];

timestampTests.forEach((test, index) => {
    const result = testTimestampValidation(test.input);
    const passed = result.valid === test.expected;
    console.log(`  Test ${index + 1}: ${test.input} => ${passed ? 'PASS' : 'FAIL'} (${result.reason || result.value})`);
});

// Test 2: File extension validation
console.log('\nTesting file extension validation...');

function testFileExtension(filename) {
    const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.mpeg', '.mpg', '.avi'];
    const fileExt = path.extname(filename || '').toLowerCase();
    return ALLOWED_EXTENSIONS.includes(fileExt);
}

const fileExtTests = [
    { input: 'video.mp4', expected: true },
    { input: 'video.mov', expected: true },
    { input: 'video.avi', expected: true },
    { input: 'video.txt', expected: false },
    { input: 'video.exe', expected: false },
    { input: 'video', expected: false },
    { input: '../../evil.mp4', expected: true }, // Extension is valid but path isn't
];

fileExtTests.forEach((test, index) => {
    const result = testFileExtension(test.input);
    const passed = result === test.expected;
    console.log(`  Test ${index + 1}: ${test.input} => ${passed ? 'PASS' : 'FAIL'}`);
});

// Test 3: Path validation
console.log('\nTesting path validation...');

function testPathValidation(filePath) {
    if (filePath.includes('..') || filePath.includes('~') || filePath.includes('$') || 
        filePath.includes('|') || filePath.includes('&') || filePath.includes(';') ||
        filePath.includes('`') || filePath.includes('(') || filePath.includes(')')) {
        return false;
    }
    
    if (filePath.includes('\0') || /[\x00-\x1f\x7f-\x9f]/.test(filePath)) {
        return false;
    }
    
    return true;
}

const pathTests = [
    { input: '/tmp/safe-file.mp4', expected: true },
    { input: '/tmp/../etc/passwd', expected: false },
    { input: '/tmp/file$(whoami).mp4', expected: false },
    { input: '/tmp/file;rm -rf /.mp4', expected: false },
    { input: '/tmp/file|cat /etc/passwd.mp4', expected: false },
    { input: '/tmp/normal-file.mp4', expected: true },
];

pathTests.forEach((test, index) => {
    const result = testPathValidation(test.input);
    const passed = result === test.expected;
    console.log(`  Test ${index + 1}: ${test.input} => ${passed ? 'PASS' : 'FAIL'}`);
});

console.log('\nSecurity tests completed!');
