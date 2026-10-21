// Private file storage in S3 (profile photos). The browser uploads and downloads directly with
// short-lived presigned URLs; the API decides who may get one. Same approach as Vehicle Maintenance.
//
// Keys: avatars/<user id>/<id>.<ext>

import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function createS3Files({ bucket, client } = {}) {
  const s3 = client ?? new S3Client({});
  return {
    /** URL the browser PUTs the file to. Type and size are part of the signature. */
    signUpload(key, { type, size }) {
      return getSignedUrl(s3, new PutObjectCommand({
        Bucket: bucket, Key: key, ContentType: type, ContentLength: size,
      }), { expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length']) });
    },

    /** URL for showing a stored file; good for an hour. */
    signDownload(key, { name, type }) {
      const safe = String(name ?? 'file').replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file';
      return getSignedUrl(s3, new GetObjectCommand({
        Bucket: bucket, Key: key,
        ResponseContentType: type,
        ResponseContentDisposition: `inline; filename="${safe}"`,
        ResponseCacheControl: 'private, max-age=3600',
      }), { expiresIn: 3600 });
    },

    /** Size of an uploaded object, or null if it isn't there. */
    async size(key) {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return res.ContentLength ?? 0;
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
        throw err;
      }
    },

    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        if (chunk.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
}
