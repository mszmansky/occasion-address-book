// Thin DynamoDB data layer (single-table design).
//
//   PK = USER#<Cognito user id (sub)>
//   SK = PROFILE                     user settings: name, return address, print offsets
//        HH#<householdId>            household: label name, address, members, groups
//        OCC#<occasionId>            occasion: Christmas cards 2026, Graduation party...
//        TAG#<occasionId>#<hhId>     a household tagged for an occasion (mailed / invited state)
//
//   PK = TOKEN#<sha256 of link token>, SK = TOKEN
//        address-update link sent to a household; expires through the table's TTL ("ttl")
//
//   PK = USPS#QUOTA, SK = MIN#<yyyy-mm-ddThh:mm> | BLOCK
//        USPS address checks made in each minute (for the 60-an-hour limit), removed by TTL

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export const userPk = (sub) => `USER#${sub}`;

export function createDynamoRepo({ tableName, client } = {}) {
  const doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  async function queryAll(input) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await doc.send(new QueryCommand({ TableName: tableName, ...input, ExclusiveStartKey }));
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  // BatchWrite takes 25 requests at a time and may hand some back to retry.
  async function batchWrite(all, verb) {
    for (let i = 0; i < all.length; i += 25) {
      let requests = all.slice(i, i + 25);
      for (let attempt = 0; requests.length && attempt < 5; attempt++) {
        const res = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
        requests = res.UnprocessedItems?.[tableName] ?? [];
        if (requests.length) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
      if (requests.length) throw new Error(`Could not ${verb} all items; try again`);
    }
  }

  return {
    async get(pk, sk) {
      const res = await doc.send(new GetCommand({ TableName: tableName, Key: { PK: pk, SK: sk } }));
      return res.Item ?? null;
    },
    async put(item) {
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return item;
    },
    /**
     * Saves only if the stored item still has the given updatedAt (nobody saved in between);
     * otherwise throws an error named ConditionalCheckFailedException.
     */
    async putIfUnchanged(item, updatedAt) {
      await doc.send(new PutCommand({
        TableName: tableName, Item: item,
        ...(updatedAt
          ? { ConditionExpression: 'updatedAt = :u', ExpressionAttributeValues: { ':u': updatedAt } }
          : { ConditionExpression: 'attribute_not_exists(updatedAt)' }),
      }));
      return item;
    },
    async del(pk, sk) {
      await doc.send(new DeleteCommand({ TableName: tableName, Key: { PK: pk, SK: sk } }));
    },
    async query(pk, skPrefix) {
      return queryAll(skPrefix
        ? {
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
        }
        : { KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': pk } });
    },
    /** Adds n to a number attribute (creating the item if needed) and returns the new value. */
    async increment(pk, sk, field, n = 1, { ttl } = {}) {
      const res = await doc.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: pk, SK: sk },
        UpdateExpression: `ADD #f :n${ttl ? ' SET #ttl = :ttl' : ''}`,
        ExpressionAttributeNames: { '#f': field, ...(ttl ? { '#ttl': 'ttl' } : {}) },
        ExpressionAttributeValues: { ':n': n, ...(ttl ? { ':ttl': ttl } : {}) },
        ReturnValues: 'UPDATED_NEW',
      }));
      return res.Attributes?.[field] ?? n;
    },
    async batchDel(keys) {
      await batchWrite(keys.map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } })), 'delete');
    },
    async batchPut(items) {
      await batchWrite(items.map((Item) => ({ PutRequest: { Item } })), 'save');
    },
  };
}
