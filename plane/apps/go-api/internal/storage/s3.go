package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3 struct {
	Client              *minio.Client
	BucketName          string
	SignedURLExpiration time.Duration
	PublicEndpointURL   string
}

func NewS3(endpoint, accessKey, secretKey, region, bucketName, publicEndpoint string, useSSL bool, expiration time.Duration) (*S3, error) {
	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: region,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize s3 client: %w", err)
	}

	return &S3{
		Client:              minioClient,
		BucketName:          bucketName,
		SignedURLExpiration: expiration,
		PublicEndpointURL:   publicEndpoint,
	}, nil
}

func (s *S3) Upload(ctx context.Context, key string, data io.Reader, size int64, contentType string) (string, error) {
	opts := minio.PutObjectOptions{}
	if contentType != "" {
		opts.ContentType = contentType
	}
	_, err := s.Client.PutObject(ctx, s.BucketName, key, data, size, opts)
	if err != nil {
		return "", fmt.Errorf("s3 upload error: %w", err)
	}
	return s.GetURL(key), nil
}

func (s *S3) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	return s.Client.GetObject(ctx, s.BucketName, key, minio.GetObjectOptions{})
}

func (s *S3) Delete(ctx context.Context, key string) error {
	return s.Client.RemoveObject(ctx, s.BucketName, key, minio.RemoveObjectOptions{})
}

func (s *S3) GetURL(key string) string {
	if s.PublicEndpointURL != "" {
		return fmt.Sprintf("%s/%s/%s", s.PublicEndpointURL, s.BucketName, key)
	}
	return key
}

func (s *S3) GeneratePresignedPost(ctx context.Context, objectName string, fileType string, fileSize int64) (map[string]any, error) {
	policy := minio.NewPostPolicy()
	if err := policy.SetBucket(s.BucketName); err != nil {
		return nil, err
	}
	if err := policy.SetKey(objectName); err != nil {
		return nil, err
	}
	if err := policy.SetExpires(time.Now().UTC().Add(s.SignedURLExpiration)); err != nil {
		return nil, err
	}
	if err := policy.SetContentType(fileType); err != nil {
		return nil, err
	}
	if err := policy.SetContentLengthRange(1, fileSize); err != nil {
		return nil, err
	}

	u, formData, err := s.Client.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return nil, fmt.Errorf("failed to generate presigned post: %w", err)
	}

	var parsedURL string
	if s.PublicEndpointURL != "" {
		// Use public endpoint
		parsedURL = fmt.Sprintf("%s/%s", s.PublicEndpointURL, s.BucketName)
	} else {
		parsedURL = u.String()
	}

	return map[string]any{
		"url":    parsedURL,
		"fields": formData,
	}, nil
}
