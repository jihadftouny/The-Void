/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 * Abilities will have a base turn of 2, modified based on corresponding STATS
 * if STR gets greater than x value, player is able to apply force conditions as
 * well
 */
public class Condition {

    public String name;
    int maxTurns, tempTurns; //COULD ROLL A DICE INSTEAD OF SETTING FIXED TURNS, ALSO, ADD +1 TO AVOID BEING MIN 2
    public String conditionText;

    // PHYSICAL (CON helps you resist them once affected needs to wait or external help, STR cause them)
    public static Condition bleed = new Condition("Bleed", 2);
    public static Condition stun = new Condition("Stun", 2);
    public static Condition fracture = new Condition("Fracture", 100); // Needs rest to go away, gives disadvantage
    public static Condition regeneration = new Condition("Regeneration", 2);

    // BASIC ELEMENTAL (CON chance of breaking, INT cause)
    public static Condition burn = new Condition("Burn", 2); //dmg per turn
    public static Condition freeze = new Condition("Freeze", 2); //like stun but chance of breaking based on strength
    public static Condition electrify = new Condition("Electrify", 2);
    public static Condition poison = new Condition("Poison", 2);

    // PSYCHIC (WIS resist/cause)
    public static Condition sleep = new Condition("Sleep", 2);
    public static Condition insanity = new Condition("Insanity", 2);

    // FORCE (WIS)
    public static Condition paralysis = new Condition("Paralysis", 2);
    public static Condition push = new Condition("Push", 1); // if pushed hard enough, can stun
    public static Condition aired = new Condition("Aired", 2);

    // STATS AUGMENTATION WILL BE DONE AFTER RELEASE
    public static Condition strong = new Condition("Strong", 2);
    public static Condition quick = new Condition("Quick", 2);
    public static Condition healthy = new Condition("Healthy", 2);
    public static Condition smart = new Condition("Smart", 2);
    public static Condition wise = new Condition("Wise", 2);
    public static Condition charming = new Condition("Charming", 2);

    // STATS DEPRIVATION (the augmentation will be caused by substances, these are like withdrawals. Can get worse by time, can be healed always)
    public static Condition weak = new Condition("Weak", 2);
    public static Condition slow = new Condition("Slow", 2);
    public static Condition sick = new Condition("Sick", 2);
    public static Condition dumb = new Condition("Dumb", 2);
    public static Condition fool = new Condition("Fool", 2);
    public static Condition repulsive = new Condition("Repulsive", 2);

    public Condition(String name, int maxTurns) {
        this.name = name;
        this.maxTurns = maxTurns;
        this.tempTurns = maxTurns;
    }

    public static void tickConditions() {
        int damage;

        //CHAIN FOR PLAYER, MUST DO ONE FOR ENEMY
        if (!Player.activeConditions.isEmpty()) {
            int savingThrow = 0;
            for (Condition i : Player.activeConditions) {
                if (i.equals(null)) {//<editor-fold defaultstate="collapsed" desc="condition empty template">

                }
                //</editor-fold>
                if (i.equals(burn)) {//<editor-fold defaultstate="collapsed" desc="Burn">
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("You have been burned!");
                        i.tempTurns--;
                    } else if (i.tempTurns > 0) {
                        damage = 3;
                        SkillEnemy.target.hp -= damage;
                        System.out.println("You took " + damage + " damage from burning.");
                        i.tempTurns--;
                    } else {
                        System.out.println("You are no longer burning!");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
                if (i.equals(freeze)) {//<editor-fold defaultstate="collapsed" desc="Freeze">
                    savingThrow += Dice.rollDice(Dice.d20) + Player.staticStatsMods[0];
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("You have been frozen.");
                        i.tempTurns--;
                        GameLogic.isPlayerSkipTurn = true;
                    } else if (i.tempTurns > 0) {
                        System.out.println("You are frozen.");
                        i.tempTurns--;
                        GameLogic.isPlayerSkipTurn = true;

                        if (savingThrow >=  Enemy.staticStats[3]) {
                            System.out.println("You brutely break from the ice that covered you!");
                            i.tempTurns = i.maxTurns;
                            Player.activeConditions.remove(i);
                            break;
                        }
                        
                    } else {
                        System.out.println("The ice arround you melts away...");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
            }
        } //END OF PLAYER CHAIN
        //do an if chain (just ifs) for each condition
    }
}
