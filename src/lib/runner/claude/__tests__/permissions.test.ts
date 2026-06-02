import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {toPermissionGlob, writePermissions} from '../permissions.js';

describe('toPermissionGlob', () => {
    it('converts a Windows backslash drive path to MSYS form', () => {
       expect(toPermissionGlob('C:\\Users\\me\\proj')).toBe('//c/Users/me/proj');
    });

    it('converts a Windows forward-slash drive path to MSYS form (lowercased drive)', () => {
       expect(toPermissionGlob('D:/Dev/Personal Projects/csi-opsx')).toBe('//d/Dev/Personal Projects/csi-opsx');
    });

    it('prefixes a POSIX absolute path with one extra slash', () => {
       expect(toPermissionGlob('/Users/me/proj')).toBe('//Users/me/proj');
    });
});

describe('writePermissions', () => {
    let workspaceDir: string;
    const PROJECT_ROOT = 'C:\\Users\\me\\proj';
    const CLAUDE_DIR = '.claude';
    const SETTINGS_JSON = 'settings.json';

    beforeEach(() => {
        workspaceDir = join(tmpdir(), `perms-test-${Date.now()}`);
        mkdirSync(workspaceDir, { recursive: true });
    });
    afterEach(() => {
        rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('creates a .claude/settings.json', () => {
       writePermissions(workspaceDir, PROJECT_ROOT);
       expect(existsSync(join(workspaceDir, CLAUDE_DIR, SETTINGS_JSON))).toBe(true);
    });

    it('lists the project root under additionalDirectories (native path)', () => {
        writePermissions(workspaceDir, PROJECT_ROOT);
        const settings = JSON.parse(readFileSync(join(workspaceDir, CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
        expect(settings.permissions.additionalDirectories).toEqual([PROJECT_ROOT]);
    });

    it('denies Write and Edit on the project subtree using the glob form', () => {
        writePermissions(workspaceDir, PROJECT_ROOT);
        const settings = JSON.parse(readFileSync(join(workspaceDir, CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
        expect(settings.permissions.deny).toContain('Write(//c/Users/me/proj/**)');
        expect(settings.permissions.deny).toContain('Edit(//c/Users/me/proj/**)');
    });

    it('does not emit an allow list or a Write(*) catch-all', () => {
        writePermissions(workspaceDir, PROJECT_ROOT);
        const settings = JSON.parse(readFileSync(join(workspaceDir, CLAUDE_DIR, SETTINGS_JSON), 'utf8'));
        expect(settings.permissions.allow).toBeUndefined();
        expect(settings.permissions.deny).not.toContain('Write(*)');
    });
});