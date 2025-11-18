import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TestProject {
  root: string;
  files: Map<string, string>;
  cleanup: () => void;
}

export function createTestProject(baseDir: string, name: string): TestProject {
  // Ensure baseDir exists first
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  const root = join(baseDir, name);
  mkdirSync(root, { recursive: true });

  const files = new Map<string, string>();

  return {
    root,
    files,
    cleanup: () => {
      const { rmSync } = require('node:fs');
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function addFile(project: TestProject, relativePath: string, content: string): void {
  const fullPath = join(project.root, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
  project.files.set(relativePath, content);
}

export const SAMPLE_COMPONENTS = {
  goodComponent: `
import { Component } from '@angular/core';

@Component({
  selector: 'app-good',
  template: '<div>Good Component</div>',
})
export class GoodComponent {
  private readonly data: string[] = [];

  processData(): void {
    this.data.forEach(item => console.log(item));
  }
}
`,

  componentWithIssues: `
import { Component } from '@angular/core';

@Component({
  selector: 'app-bad',
  template: '<div>Bad Component</div>',
})
export class BadComponent {
  data: any;

  processData() {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i]) {
        if (this.data[i].value) {
          if (this.data[i].value > 0) {
            console.log(this.data[i].value);
          }
        }
      }
    }
  }
}
`,

  serviceWithSecurity: `
import { Injectable } from '@angular/core';

@Injectable()
export class DataService {
  executeQuery(userId: string): void {
    const query = "SELECT * FROM users WHERE id = '" + userId + "'";
    console.log(query);
  }
}
`,
};

export function createMockAIProvider() {
  return {
    name: 'mock',
    initialize: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue({
      content: 'Mock AI response',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }),
    completeWithStructure: jest.fn().mockResolvedValue({}),
    invoke: jest.fn().mockResolvedValue('Mock response'),
    isAvailable: jest.fn().mockReturnValue(true),
    getModelName: jest.fn().mockReturnValue('claude-sonnet-4-20250514'),
    getMaxTokens: jest.fn().mockReturnValue(4000),
    getTokenStats: jest.fn().mockReturnValue({
      invocationCount: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      estimatedCost: 0.001,
      startTime: new Date(),
    }),
    resetTokenStats: jest.fn(),
  };
}
