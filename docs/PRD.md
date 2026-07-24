Nếu mục tiêu cuối cùng của bạn là xây dựng **AI-Native Testing Platform** dựa trên **Screenplay Pattern**, thì mình đề xuất chỉ giữ 5 Runner cốt lõi sau. Đây là đủ để bao phủ gần như toàn bộ quy trình QA từ thiết kế, thực thi, xác minh đến xử lý sự cố.

| Runner                            | Mục tiêu                               | Đối tượng sử dụng                  | Khả năng chính                                                              |
| --------------------------------- | -------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| **API Runner**                    | Kiểm thử API và Service                | Manual Tester, Automation Engineer | REST, gRPC, GraphQL, SOAP, WebSocket, Authentication, Assertions, Variables |
| **UI Runner**                     | Kiểm thử giao diện Web/Mobile          | Manual Tester, Automation Engineer | Simple Mode, Advanced Mode, Playwright/Selenium, Screenplay Pattern         |
| **Database + Kafka/Redis Runner** | Kiểm tra hậu điều kiện của hệ thống    | Automation Engineer                | SQL, Database Verification, Kafka, RabbitMQ, Redis, Event Validation        |
| **AI Runner**                     | Hỗ trợ AI trong toàn bộ quy trình QA   | QC, QA Lead, Automation Engineer   | Sinh Test Analysis, Test Design, Test Cases, Automation, Review, Report     |
| **Incident Runner**               | Thu thập bằng chứng và phân tích sự cố | QC, SRE, Dev, QA Lead              | Collect Logs, Metrics, API Trace, Root Cause Analysis, Incident Report      |

---

# 1. API Runner

### Mục tiêu

Thực thi mọi loại API test.

### Protocol hỗ trợ

```text
REST
gRPC
GraphQL
SOAP
WebSocket
```

### Chức năng

```text
Authentication

Bearer

OAuth2

Basic

API Key

Certificate

mTLS
```

```text
Request Builder

Headers

Query

Path

Cookie

Body

Multipart

File Upload
```

```text
Assertions

Status Code

Headers

Body

JSON Schema

Proto Schema

Response Time

Business Rules
```

### Ví dụ Workflow

```text
Actor

Authenticated Customer

↓

Task

Create Payment

↓

Questions

HTTP Status = 201

↓

Response Status = SUCCESS

↓

Remember paymentId
```

---

# 2. UI Runner

UI Runner nên có **2 chế độ** để phù hợp với cả manual tester và automation engineer.

## Simple Mode

Dành cho Manual Tester.

Ẩn toàn bộ khái niệm Screenplay.

Workflow:

```text
Open Browser

↓

Go to Page

↓

Click

↓

Input

↓

Run

↓

Verify
```

GUI giống:

```text
Playwright Recorder

+

Postman
```

Người dùng chỉ thấy:

```text
Request

↓

Run

↓

Result

↓

Assertion
```

---

## Advanced Mode

Dành cho Automation Engineer.

Hiển thị đầy đủ Screenplay Pattern.

```text
Actor

↓

Ability

↓

Task

↓

Interaction

↓

Question
```

Ví dụ:

```text
Actor

Customer

↓

Ability

Browse Web

↓

Task

Create Payment

↓

Interactions

Click

Type

Upload

↓

Questions

Visible

Enabled

Text

Database
```

### Sinh code

Có thể generate:

```text
Playwright

Serenity

Selenium

Java

TypeScript
```

---

# 3. Database + Kafka/Redis Runner

Đây là Runner kiểm tra **side effects** sau khi API hoặc UI hoàn thành.

## Database

```text
Execute SQL

Verify Record

Insert Test Data

Delete Test Data

Rollback

Compare Data
```

Ví dụ

```text
Create Payment

↓

Verify payment table

↓

Verify amount

↓

Verify status
```

---

## Kafka / MQ

```text
Publish Event

Consume Event

Verify Payload

Verify Offset

Verify Retry
```

Ví dụ

```text
Create Payment

↓

Consume PAYMENT_CREATED

↓

Verify payload
```

---

## Redis

```text
Verify Cache

Delete Cache

Insert Cache

TTL Verification
```

Ví dụ

```text
Login

↓

Verify Redis Session

↓

TTL = 1800
```

---

# 4. AI Runner

Đây là Runner giúp AI tham gia vào toàn bộ vòng đời QA.

## Input

```text
Requirement

API Spec

User Story

Incident

Log

Code

Test Case
```

## Output

```text
Test Analysis

↓

Test Design

↓

Test Cases

↓

Automation Script

↓

Review

↓

Summary

↓

Report
```

### AI Skills

```text
Requirement Review

Risk Analysis

Gap Analysis

Generate Test Cases

Generate API Test

Generate SQL

Review Automation

Review Incident

Root Cause Analysis

Generate Release Note
```

### Ví dụ

```text
Requirement

↓

AI Review

↓

Generate Test Analysis

↓

Review Quality

↓

Generate Test Design

↓

Generate Test Cases

↓

Generate Automation
```

---

# 5. Incident Runner

Runner chuyên xử lý Incident.

## Workflow

```text
Receive Incident

↓

Collect API Logs

↓

Collect Kibana

↓

Collect Grafana

↓

Collect Database

↓

Collect Kafka

↓

Collect Trace

↓

Generate Report

↓

Suggest Root Cause

↓

Create Jira
```

## Dữ liệu thu thập

```text
API Request

API Response

Database

Redis

Kafka

Application Logs

System Logs

Grafana Metrics

Kibana Logs

OpenTelemetry Trace

Thread Dump
```

## AI hỗ trợ

```text
Cluster Similar Incidents

Find Similar Root Cause

Suggest RCA

Generate Timeline

Generate Incident Report
```

Ví dụ

```text
Incident

↓

Collect Logs

↓

Analyze

↓

Find Similar Incident

↓

Suggest Root Cause

↓

Generate Report
```

---

# Kiến trúc tổng thể

```text
                   Screenplay Engine
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
     Actor              Context           Variables
        │
        ▼
                     Task Dispatcher
                           │
     ┌───────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
     │               │               │               │               │
 API Runner      UI Runner      DB/Event Runner    AI Runner    Incident Runner
     │               │               │               │               │
 REST           Playwright      SQL/Kafka/Redis   LLM Skills    Logs/Metrics/RCA
 gRPC           Selenium        Verification      Review        Incident Analysis
 GraphQL        Screenplay      Side Effects      Generation    Jira Integration
```

---

# Một Test Workflow hoàn chỉnh

Ví dụ kiểm thử tính năng thanh toán:

```text
Requirement
        │
        ▼
AI Runner
- Review Requirement
- Generate Test Analysis
        │
        ▼
API Runner
- Login
- Create Payment
        │
        ▼
Database + Kafka/Redis Runner
- Verify Payment Table
- Verify Kafka Event
- Verify Redis Cache
        │
        ▼
UI Runner
- Login Web
- Verify Payment History
        │
        ▼
Incident Runner (chỉ khi có lỗi)
- Collect Logs
- Collect Metrics
- Analyze Root Cause
- Generate Incident Report
```

## Giá trị của mô hình này

Thay vì xem Screenplay chỉ là một framework automation test, bạn có thể xem nó như **Workflow Orchestration Engine** cho QA.

* **API Runner** chịu trách nhiệm tương tác với các service.
* **UI Runner** xác minh hành vi người dùng trên giao diện, với **Simple Mode** cho manual tester và **Advanced Mode** cho automation engineer.
* **Database + Kafka/Redis Runner** xác minh các tác động phía sau (side effects) mà API/UI tạo ra.
* **AI Runner** hỗ trợ phân tích, sinh artefact và review xuyên suốt quy trình QA.
* **Incident Runner** tự động thu thập bằng chứng, phân tích nguyên nhân và tạo báo cáo khi phát hiện lỗi.

Với kiến trúc này, tất cả Runner đều được điều phối bởi cùng một Screenplay Engine, sử dụng chung các khái niệm **Actor → Ability → Task → Interaction → Question**, giúp mở rộng thêm Runner mới trong tương lai mà không cần thay đổi mô hình cốt lõi.
