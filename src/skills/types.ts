/**
 * Types for the Venice agent skill system.
 */

export interface SkillManifest {
  name: string;
  description: string;
  tools?: string[];
}

export interface SkillSummary {
  name: string;
  description: string;
  tools: string[];
  source: string;
}

export interface Skill {
  name: string;
  description: string;
  tools: string[];
  source: string;
  content: string;
}
