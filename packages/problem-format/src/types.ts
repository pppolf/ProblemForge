import type {ProblemManifest}from'@problemforge/contracts';
export type Purpose='STATEMENT'|'EDITORIAL_DOCUMENT'|'EDITORIAL_BEAMER'|'DATA'|'REFERENCE'|'FULL';
export type Issue={area:string;status:'MAPPED'|'WARNING'|'BLOCKED';message:string;fileName?:string};
export type Profile=ProblemManifest['programs'][number]['profile'];
export type PackageResult={files:Map<string,Buffer>;report:Issue[]};
export type ImportResult={manifest:ProblemManifest;report:Issue[]};
export interface Exporter { readonly id:string; export(manifest:ProblemManifest,purpose:Purpose,read:(key:string)=>Promise<Buffer>):Promise<PackageResult>; }
