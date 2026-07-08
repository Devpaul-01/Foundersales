"""
Email Integration using Resend (replaces Flask-Mail / SMTP)
Resend uses HTTP instead of SMTP so it works reliably on Render free tier.

Install: pip install resend
Env var: RESEND_API_KEY
"""

import logging
import os
from datetime import datetime, timedelta
from threading import Thread

# Third-party imports
import jwt
import resend
from flask import current_app
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import or_, and_

# Local imports
import set_env
from models import Connection, User

# Configure Resend API key
resend.api_key = os.environ.get("RESEND_API_KEY")

RESEND_FROM = "StudyHub <onboarding@resend.dev>"

# Initialize limiter
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

logger = logging.getLogger(__name__)


# ============================================================================
# ONLINE STATUS
# ============================================================================

def get_user_online_status(user_id):
    """
    Get user's online status and formatted last active time.
    Returns:
        {
            "is_online": bool,
            "in_study_session": bool,
            "last_active": str | None
        }
    """
    try:
        user = User.query.get(user_id)

        if not user or not user.last_active:
            return {
                "is_online": False,
                "in_study_session": False,
                "last_active": "Never"
            }

        now = datetime.utcnow()
        time_diff = now - user.last_active
        minutes_ago = time_diff.total_seconds() / 60
        is_online = minutes_ago < 30

        if user.in_study_session:
            return {
                "is_online": True,
                "in_study_session": True,
                "last_active": None
            }

        if is_online:
            return {
                "is_online": True,
                "in_study_session": False,
                "last_active": None
            }

        if minutes_ago < 60:
            last_active_text = f"{int(minutes_ago)}m"
        elif minutes_ago < 1440:
            hours = int(minutes_ago // 60)
            last_active_text = f"{hours}h"
        else:
            days = int(minutes_ago // 1440)
            last_active_text = f"{days}d"

        return {
            "is_online": False,
            "in_study_session": False,
            "last_active": last_active_text
        }

    except Exception as e:
        current_app.logger.error(f"Online status error: {str(e)}")
        return {
            "is_online": False,
            "in_study_session": False,
            "last_active": "Unknown"
        }


# ============================================================================
# MESSAGING HELPERS
# ============================================================================

def can_message(sender_id, receiver_id):
    """
    Check if sender can message receiver.
    Rules:
    1. Must have accepted connection, OR
    2. System message exception
    Note: Thread members CANNOT DM - must connect first
    """
    if sender_id == receiver_id:
        return False

    connection = Connection.query.filter(
        or_(
            and_(Connection.requester_id == sender_id, Connection.receiver_id == receiver_id),
            and_(Connection.requester_id == receiver_id, Connection.receiver_id == sender_id)
        ),
        Connection.status == "accepted"
    ).first()

    return bool(connection)


def get_conversation_partner(conversation, current_user_id):
    """Get the other user in a conversation"""
    if conversation.get("user1_id") == current_user_id:
        return User.query.get(conversation.get("user2_id"))
    return User.query.get(conversation.get("user1_id"))


def create_conversation_key(user1_id, user2_id):
    sorted_ids = sorted([user1_id, user2_id])
    return f"{sorted_ids[0]}-{sorted_ids[1]}"


def get_app_url():
    """Get application URL"""
    url = os.environ.get('CURRENT_URL', 'http://127.0.0.1:5001/')
    if not url.endswith('/'):
        url += '/'
    return url


# ============================================================================
# JWT HELPERS
# ============================================================================

def decode_token(token):
    """
    Decode and verify a JWT token.
    Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError on failure.
    """
    try:
        secret = os.environ.get("SECRET_KEY")
        if not secret:
            current_app.logger.error("SECRET_KEY not found in environment")
            raise jwt.InvalidTokenError("Server configuration error")
        return jwt.decode(token, secret, algorithms=["HS256"])

    except jwt.ExpiredSignatureError:
        current_app.logger.warning("Token has expired")
        raise

    except jwt.InvalidTokenError as e:
        current_app.logger.error(f"Invalid token: {str(e)}")
        raise

    except Exception as e:
        current_app.logger.error(f"Token decode error: {str(e)}")
        raise jwt.InvalidTokenError(f"Failed to decode token: {str(e)}")


def generate_tokens_for_user(user):
    secret = os.environ.get("SECRET_KEY")

    access_payload = {
        "user_id": user.id,
        "email": user.email,
        "role": user.role,
        "username": user.username,
        "exp": datetime.utcnow() + timedelta(minutes=30)
    }

    refresh_payload = {
        "user_id": user.id,
        "email": user.email,
        "exp": datetime.utcnow() + timedelta(days=30)
    }

    access_token = jwt.encode(access_payload, secret, algorithm="HS256")
    refresh_token = jwt.encode(refresh_payload, secret, algorithm="HS256")

    return access_token, refresh_token


def generate_verification_token(email):
    """Generate a secure JWT token that expires in 5 hours."""
    try:
        secret_key = os.environ.get("SECRET_KEY")
        payload = {
            "email": email,
            "exp": datetime.utcnow() + timedelta(hours=5),
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, secret_key, algorithm="HS256")
    except Exception as e:
        print("Token generation error:", e)
        return None


def verify_token(token):
    """
    Verify a JWT token and return the email if valid.
    Handles expired or invalid tokens gracefully.
    """
    try:
        secret_key = os.environ.get("SECRET_KEY")
        decoded = jwt.decode(token, secret_key, algorithms=["HS256"])
        return decoded.get("email")
    except jwt.ExpiredSignatureError:
        return {"error": "Token has expired"}
    except jwt.InvalidTokenError:
        return {"error": "Invalid token"}
    except Exception as e:
        return {"error": f"Token verification failed: {str(e)}"}


# ============================================================================
# EMAIL — powered by Resend (HTTP, not SMTP — works reliably on Render free tier)
# ============================================================================

def _send_resend_email(to_email, subject, html):
    """
    Internal helper: send one email via Resend HTTP API.
    No Flask app context needed — safe to call from a background thread.
    """
    try:
        resend.Emails.send({
            "from": RESEND_FROM,
            "to": to_email,
            "subject": subject,
            "html": html,
        })
        logger.info(f"✅ Email sent via Resend to {to_email}")
        return True
    except Exception as e:
        logger.error(f"❌ Resend email failed to {to_email}: {e}")
        return False


def send_verification_email(email, link):
    """Send email verification link via Resend (non-blocking)."""
    subject = "✅ Verify Your StudyHub Email"
    html = f"""
    <html>
    <body style="font-family: Arial; padding: 40px; text-align: center;">
        <h1 style="color: #667eea;">Welcome to StudyHub!</h1>
        <p>Click the button below to verify your email address:</p>
        <a href="{link}" style="display: inline-block; margin: 20px 0; padding: 15px 30px;
           background: #667eea; color: white; text-decoration: none; border-radius: 5px;">
           Verify Email
        </a>
        <p style="color: #999; font-size: 12px;">This link expires in 5 hours.</p>
    </body>
    </html>
    """
    thread = Thread(target=_send_resend_email, args=(email, subject, html))
    thread.daemon = True
    thread.start()
    logger.info(f"✅ Verification email queued for {email}")


def send_password_reset(email, link):
    """Send password reset email via Resend (non-blocking)."""
    subject = "🔐 Reset Your StudyHub Password"
    html = f"""
    <html>
    <body style="font-family: Arial; padding: 40px; text-align: center;">
        <h1 style="color: #667eea;">Reset Your Password</h1>
        <p>Click the button below to reset your password:</p>
        <a href="{link}" style="display: inline-block; margin: 20px 0; padding: 15px 30px;
           background: #667eea; color: white; text-decoration: none; border-radius: 5px;">
           Reset Password
        </a>
        <p style="color: #999; font-size: 12px;">This link expires in 5 hours.</p>
    </body>
    </html>
    """
    thread = Thread(target=_send_resend_email, args=(email, subject, html))
    thread.daemon = True
    thread.start()
    logger.info(f"✅ Password reset email queued for {email}")


def send_email_now(to_email, subject, html_content, async_send=True):
    """
    General-purpose email sender via Resend.

    Args:
        to_email: Recipient email
        subject: Email subject
        html_content: HTML content
        async_send: If True (default), sends in a background thread

    Returns:
        bool: True if sent/queued, False if failed
    """
    print("\n" + "="*70)
    print("📧 SENDING EMAIL via Resend")
    print("="*70)
    print(f"To: {to_email}")
    print(f"Subject: {subject}")
    print(f"Async: {async_send}")
    print("="*70)

    try:
        if async_send:
            thread = Thread(target=_send_resend_email, args=(to_email, subject, html_content))
            thread.daemon = True
            thread.start()
            print("✅ EMAIL QUEUED FOR BACKGROUND SEND")
            print("="*70 + "\n")
            return True
        else:
            result = _send_resend_email(to_email, subject, html_content)
            print("✅ EMAIL SENT!" if result else "❌ EMAIL FAILED")
            print("="*70 + "\n")
            return result

    except Exception as e:
        print(f"❌ FAILED: {e}")
        print("="*70 + "\n")
        logger.error(f"Email send error: {e}", exc_info=True)
        return False


# ============================================================================
# WAITLIST EMAILS
# ============================================================================

def send_waitlist_welcome_email(to_email, referral_code, position, tier_info):
    """Send waitlist welcome email (async by default)"""

    print(f"\n🎯 send_waitlist_welcome_email() called for {to_email}")

    try:
        app_url = get_app_url()
        referral_link = f"{app_url}?ref={referral_code}"

        benefits = tier_info["benefits"]
        benefit1 = benefits[0] if len(benefits) > 0 else "Early Access"
        benefit2 = benefits[1] if len(benefits) > 1 else "Premium Features"
        benefit3 = benefits[2] if len(benefits) > 2 else "Community Access"

        launch_date = "January 2025"
        subject = f"🎉 You're #{position} on the StudyHub Waitlist!"

        html = f"""
<!DOCTYPE html><html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 0;">
    <div style="max-width: 650px; margin: auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">

    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 32px; font-weight: 700;">🎉 Welcome to StudyHub!</h1>
        <div style="margin: 20px 0; font-size: 48px; font-weight: 900;">#{position}</div>
        <p style="margin: 0; font-size: 18px; opacity: 0.95;">You're on the waitlist!</p>
    </div>

    <div style="padding: 40px 30px;">
        <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
            <h2 style="margin: 0 0 10px; color: #667eea; font-size: 24px;">{tier_info['tier']}</h2>
            <p style="margin: 0; color: #64748b; font-size: 14px;">Your exclusive tier benefits</p>
        </div>

        <div style="margin: 30px 0;">
            <h3 style="color: #1e293b; font-size: 20px; margin-bottom: 15px;">🎁 Your Benefits:</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="margin: 12px 0; color: #1e293b; font-size: 15px; line-height: 1.6;">✅ {benefit1}</li>
                <li style="margin: 12px 0; color: #1e293b; font-size: 15px; line-height: 1.6;">✅ {benefit2}</li>
                <li style="margin: 12px 0; color: #1e293b; font-size: 15px; line-height: 1.6;">✅ {benefit3}</li>
            </ul>
        </div>

        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin: 30px 0;">
            <h3 style="margin: 0 0 15px; font-size: 22px; text-align: center;">🚀 Skip the Line!</h3>
            <p style="margin: 0 0 20px; text-align: center; opacity: 0.95;">Share your unique link and climb the waitlist!</p>
            <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
                <p style="margin: 0 0 10px; font-size: 14px; opacity: 0.9;">Your Referral Link:</p>
                <a href="{referral_link}" style="color: white; font-size: 16px; font-weight: 600; text-decoration: underline; word-break: break-all;">{referral_link}</a>
            </div>
            <div style="text-align: left;">
                <p style="margin: 10px 0; font-size: 15px;">✨ <strong>Refer 3 friends</strong> → Jump 100 spots</p>
                <p style="margin: 10px 0; font-size: 15px;">🚀 <strong>Refer 10 friends</strong> → Jump to Top 100</p>
                <p style="margin: 10px 0; font-size: 15px;">👑 <strong>Refer 20 friends</strong> → Lifetime Premium + Founder Badge</p>
            </div>
        </div>

        <div style="background: #f1f5f9; padding: 20px; border-radius: 12px; text-align: center; margin: 30px 0;">
            <p style="margin: 0; color: #64748b; font-size: 14px; font-weight: 600;">🎯 LAUNCHING</p>
            <p style="margin: 8px 0 0; color: #1e293b; font-size: 28px; font-weight: 900;">{launch_date}</p>
            <p style="margin: 8px 0 0; color: #64748b; font-size: 14px;">Mark your calendar! 🎄</p>
        </div>
    </div>

    <div style="background-color: #0f172a; padding: 30px; border-top: 2px solid #6366f1; text-align: center;">
        <p style="font-size: 1.2rem; margin-bottom: 15px; font-weight: 600; color: #ffffff;">📚 StudyHub - Learn Together, Grow Together</p>
        <p style="opacity: 0.7; color: #e2e8f0; margin-bottom: 10px;">
            Questions? Email us: <a href="mailto:studyhubnoreply@gmail.com" style="color: #6366f1; text-decoration: underline;">studyhubnoreply@gmail.com</a>
        </p>
        <p style="margin-top: 15px; opacity: 0.7; color: #e2e8f0; font-size: 0.9rem;">© 2025 StudyHub. Built with ❤️ by students, for students.</p>
    </div>

    </div>
</body>
</html>
        """

        result = send_email_now(to_email, subject, html, async_send=True)
        if result:
            logger.info(f"✅ Welcome email queued for {to_email}")
        else:
            logger.error(f"❌ Welcome email failed for {to_email}")
        return result

    except Exception as e:
        logger.error(f"Exception in send_waitlist_welcome_email: {e}", exc_info=True)
        return False


def send_referral_milestone_email(to_email, referral_count, new_position, referral_code):
    """Send milestone email (async by default)"""

    print(f"\n🎯 send_referral_milestone_email() called for {to_email}")

    try:
        app_url = get_app_url()

        if referral_count == 3:
            milestone = "3 Referrals"
            reward = "Jumped 100 spots!"
            emoji = "✨"
            message = "You've unlocked your first milestone! Your position has jumped significantly on the waitlist."
        elif referral_count == 10:
            milestone = "10 Referrals"
            reward = "Jumped to Top 100!"
            emoji = "🚀"
            message = "Incredible! You're now in the top 100 and guaranteed early access with premium features."
        elif referral_count == 20:
            milestone = "20 Referrals"
            reward = "Lifetime Premium!"
            emoji = "👑"
            message = "You're a legend! You've earned Lifetime Premium Access and Founder Tier benefits. Welcome to the inner circle!"
        else:
            return False

        subject = f"{emoji} Milestone: {milestone}!"

        html = f"""
<!DOCTYPE html>
<html>
  <body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; padding: 20px 0;">
    <div style="max-width: 600px; margin: auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 3px 10px rgba(0,0,0,0.1);">

        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; color: white;">
            <div style="font-size: 64px; margin-bottom: 10px;">{emoji}</div>
            <h1 style="margin: 0; font-size: 28px;">Milestone Reached!</h1>
            <p style="margin: 10px 0 0; font-size: 18px; opacity: 0.95;">{milestone}</p>
        </div>

        <div style="padding: 40px 30px; text-align: center;">
            <h2 style="color: #1e293b; font-size: 24px; margin-bottom: 20px;">{reward}</h2>
            <p style="color: #64748b; font-size: 16px; margin-bottom: 25px;">{message}</p>

            <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); padding: 25px; border-radius: 12px; margin: 30px 0;">
                <p style="margin: 0 0 15px; color: #64748b; font-size: 16px;">Your New Position:</p>
                <div style="font-size: 48px; font-weight: 900; color: #667eea;">#{new_position}</div>
            </div>

            <p style="color: #64748b; font-size: 16px; line-height: 1.6; margin: 25px 0;">
                Amazing work! You've helped <strong style="color: #667eea;">{referral_count} friends</strong> discover StudyHub.
                Keep sharing to climb even higher! 🎯
            </p>

            <a href="{app_url}#leaderboard-section"
               style="display: inline-block; margin-top: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 35px; border-radius: 50px; text-decoration: none; font-weight: 600;">
               View Leaderboard
            </a>
        </div>

        <div style="background-color: #0f172a; padding: 30px; border-top: 2px solid #6366f1; text-align: center; margin-top: 40px;">
            <p style="font-size: 1.2rem; margin-bottom: 15px; font-weight: 600; color: #ffffff;">📚 StudyHub - Learn Together, Grow Together</p>
            <p style="opacity: 0.7; color: #e2e8f0; margin-bottom: 10px;">
                Questions? Email us: <a href="mailto:studyhubnoreply@gmail.com" style="color: #6366f1; text-decoration: underline;">studyhubnoreply@gmail.com</a>
            </p>
            <p style="margin-top: 15px; opacity: 0.7; color: #e2e8f0; font-size: 0.9rem;">© 2025 StudyHub. Built with ❤️ by students, for students.</p>
        </div>

    </div>
  </body>
</html>
        """

        result = send_email_now(to_email, subject, html, async_send=True)
        if result:
            logger.info(f"✅ Milestone email queued for {to_email}")
        else:
            logger.error(f"❌ Milestone email failed for {to_email}")
        return result

    except Exception as e:
        logger.error(f"Exception in send_referral_milestone_email: {e}", exc_info=True)
        return False
