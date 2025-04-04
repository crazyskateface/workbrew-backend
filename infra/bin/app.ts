#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WorkbruStack } from '../lib/workbru-stack';

const app = new cdk.App();
new WorkbruStack(app, 'WorkbruStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
  }
});