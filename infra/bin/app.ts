#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WorkbrewStack } from '../lib/workbrew-stack';

const app = new cdk.App();
new WorkbrewStack(app, 'WorkbrewStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
  }
});